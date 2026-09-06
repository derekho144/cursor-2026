#!/usr/bin/env bash
# Fix + rebuild ARBA after first-run failure:
#   1) ModuleNotFoundError: garf.core.version  (base image /app/garf shadowing)
#   2) run-docker.sh: [[: not found           (ENTRYPOINT sh vs bash)
#
# Cloud Shell (copy-paste):
#   curl -fsSL https://raw.githubusercontent.com/derekho144/cursor-2026/cursor/arba-first-run-fix-096b/scripts/arba-fix-rebuild.sh | bash
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-white-sandbox-485205-c1}"
REGION="${REGION:-us-central1}"
JOB="${JOB:-arba}"
ACCOUNT="${ACCOUNT:-4839352747}"
DATASET="${DATASET:-arba}"
ADS_CONFIG="${ADS_CONFIG:-gs://${PROJECT}/arba/google-ads.yaml}"
WORKDIR="${WORKDIR:-$HOME/arba-fix}"

echo "==> project=$PROJECT region=$REGION job=$JOB account=$ACCOUNT"
gcloud config set project "$PROJECT"

# Reuse Artifact Registry from existing job image when possible
EXISTING_IMAGE="$(gcloud run jobs describe "$JOB" --region="$REGION" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
if [[ -n "${EXISTING_IMAGE}" ]]; then
  echo "==> existing job image: $EXISTING_IMAGE"
  # e.g. us-central1-docker.pkg.dev/PROJECT/REPO/arba:tag
  IMAGE_BASE="${EXISTING_IMAGE%:*}"
else
  REPO="${REPO:-google-marketing-solutions}"
  IMAGE_NAME="${IMAGE_NAME:-arba}"
  gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 \
    || gcloud artifacts repositories create "$REPO" \
         --repository-format=docker --location="$REGION" --description="ARBA"
  IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}"
fi

IMAGE="${IMAGE_BASE}:fixed-$(date +%Y%m%d%H%M)"

rm -rf "$WORKDIR"
git clone --depth 1 https://github.com/google-marketing-solutions/arba.git "$WORKDIR"
cd "$WORKDIR"

# Patch Dockerfile: drop broken in-tree garf + use bash entrypoint
cat > Dockerfile <<'DOCKER'
FROM ghcr.io/google/garf:latest
COPY --from=ghcr.io/astral-sh/uv:0.5.18 /uv /bin/
ENV UV_SYSTEM_PYTHON=1
WORKDIR /app
# Remove broken in-tree package that shadows site-packages
RUN rm -rf /app/garf /app/libs 2>/dev/null || true
ADD requirements.txt .
RUN uv pip install -r requirements.txt --require-hashes --no-deps \
  && python -c "import garf.core, garf.executors; print('garf ok', getattr(garf.core, '__version__', '?'))"
ADD queries/ queries/
ADD scripts/ scripts/
ADD workflow-config.yaml .
ADD run-docker.sh .
RUN chmod +x /app/run-docker.sh
ENV WORKFLOW_FILE=/app/workflow-config.yaml
ENTRYPOINT ["bash", "/app/run-docker.sh"]
CMD ["-w", "/app/workflow-config.yaml", "-l", "local"]
DOCKER

# Patch run-docker.sh: bash [[ -> POSIX [
python3 - <<'PY'
from pathlib import Path
import re
p = Path("run-docker.sh")
t = p.read_text()
t2 = re.sub(
    r"if\s*\[\[\s*\$?\{?TAGGING_ENABLED\}?\s*-eq\s*1\s*\]\]",
    'if [ "$TAGGING_ENABLED" -eq 1 ]',
    t,
)
p.write_text(t2)
print("run-docker.sh has [[ :", "[[" in p.read_text())
PY

# Confirm ads yaml exists
echo "==> checking ADS_CONFIG $ADS_CONFIG"
gcloud storage ls "$ADS_CONFIG" || {
  echo "WARN: $ADS_CONFIG not found — list arba/ bucket:"
  gcloud storage ls "gs://${PROJECT}/arba/" || true
}

echo "==> Building $IMAGE (Cloud Build, a few minutes)"
gcloud builds submit --tag "$IMAGE" .

echo "==> Updating Cloud Run job"
gcloud run jobs update "$JOB" \
  --region="$REGION" \
  --image="$IMAGE" \
  --update-env-vars="TAGGING_ENABLED=0,ACCOUNT=${ACCOUNT},BQ_DATASET=${DATASET},ADS_CONFIG=${ADS_CONFIG},GOOGLE_CLOUD_PROJECT=${PROJECT}" \
  --args="-a,${ACCOUNT},-c,${ADS_CONFIG},-p,${PROJECT},-d,${DATASET},-t,0,-l,gcloud"

echo "==> Executing (wait)"
gcloud run jobs execute "$JOB" --region="$REGION" --wait || true

echo "==> Executions"
gcloud run jobs executions list --job="$JOB" --region="$REGION" --limit=3

echo "==> BigQuery"
bq ls --project_id="$PROJECT" "${PROJECT}:${DATASET}" || bq ls --project_id="$PROJECT" "$DATASET" || echo "(dataset still missing)"
