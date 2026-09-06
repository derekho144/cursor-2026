#!/usr/bin/env bash
# Fix + rebuild ARBA after first-run failure:
#   1) ModuleNotFoundError: garf.core.version  (base image /app/garf shadowing)
#   2) run-docker.sh: [[: not found           (ENTRYPOINT sh vs bash)
#
# Run in Google Cloud Shell:
#   bash arba-fix-rebuild.sh
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-white-sandbox-485205-c1}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-google-marketing-solutions}"
IMAGE_NAME="${IMAGE_NAME:-arba}"
JOB="${JOB:-arba}"
ACCOUNT="${ACCOUNT:-4839352747}"
DATASET="${DATASET:-arba}"
ADS_CONFIG="${ADS_CONFIG:-gs://${PROJECT}/arba/google-ads.yaml}"
WORKDIR="${WORKDIR:-$HOME/arba-fix}"

gcloud config set project "$PROJECT"

rm -rf "$WORKDIR"
git clone --depth 1 https://github.com/google-marketing-solutions/arba.git "$WORKDIR"
cd "$WORKDIR"

# --- patch Dockerfile ---
cat > Dockerfile <<'DOCKER'
FROM ghcr.io/google/garf:latest
COPY --from=ghcr.io/astral-sh/uv:0.5.18 /uv /bin/
ENV UV_SYSTEM_PYTHON=1
WORKDIR /app
# Base image may ship a broken in-tree /app/garf that shadows site-packages
RUN rm -rf /app/garf /app/libs 2>/dev/null || true
ADD requirements.txt .
RUN uv pip install -r requirements.txt --require-hashes --no-deps \
  && python -c "import garf.core.version; import garf.executors"
ADD queries/ queries/
ADD scripts/ scripts/
ADD workflow-config.yaml .
ADD run-docker.sh .
RUN chmod +x /app/run-docker.sh
ENV WORKFLOW_FILE=/app/workflow-config.yaml
ENTRYPOINT ["bash", "/app/run-docker.sh"]
CMD ["-w", "/app/workflow-config.yaml", "-l", "local"]
DOCKER

# --- patch run-docker.sh: [[ -> [ ---
if grep -q '\[\[ \$TAGGING_ENABLED' run-docker.sh 2>/dev/null || grep -q '\[\[ $TAGGING_ENABLED' run-docker.sh; then
  sed -i 's/if \[\[ \$TAGGING_ENABLED -eq 1 \]\]/if [ "$TAGGING_ENABLED" -eq 1 ]/' run-docker.sh || true
  sed -i 's/if \[\[ $TAGGING_ENABLED -eq 1 \]\]/if [ "$TAGGING_ENABLED" -eq 1 ]/' run-docker.sh || true
fi
# Also handle unescaped forms from various clones
python3 - <<'PY'
from pathlib import Path
p = Path("run-docker.sh")
t = p.read_text()
t2 = t.replace("if [[ $TAGGING_ENABLED -eq 1 ]]", 'if [ "$TAGGING_ENABLED" -eq 1 ]')
t2 = t2.replace("if [[$TAGGING_ENABLED -eq 1]]", 'if [ "$TAGGING_ENABLED" -eq 1 ]')
if t2 == t and "[[ " in t:
    import re
    t2 = re.sub(r"if\s*\[\[\s*\$TAGGING_ENABLED\s*-eq\s*1\s*\]\]", 'if [ "$TAGGING_ENABLED" -eq 1 ]', t)
p.write_text(t2)
print("run-docker.sh patched:", "[[" not in Path("run-docker.sh").read_text() or "still has [[" )
PY

# Ensure Artifact Registry repo exists (ignore if already there)
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" \
       --repository-format=docker --location="$REGION" --description="ARBA"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}:fixed-$(date +%Y%m%d%H%M)"
echo "==> Building $IMAGE"
gcloud builds submit --tag "$IMAGE" .

echo "==> Updating Cloud Run job"
gcloud run jobs update "$JOB" \
  --region="$REGION" \
  --image="$IMAGE" \
  --update-env-vars="TAGGING_ENABLED=0,ACCOUNT=${ACCOUNT},BQ_DATASET=${DATASET},ADS_CONFIG=${ADS_CONFIG},GOOGLE_CLOUD_PROJECT=${PROJECT}" \
  --args="-a,${ACCOUNT},-c,${ADS_CONFIG},-p,${PROJECT},-d,${DATASET},-t,0,-l,gcloud"

echo "==> Executing"
gcloud run jobs execute "$JOB" --region="$REGION" --wait || true

echo "==> Executions"
gcloud run jobs executions list --job="$JOB" --region="$REGION" --limit=3

echo "==> BigQuery dataset"
bq ls --project_id="$PROJECT" "${PROJECT}:${DATASET}" || bq ls --project_id="$PROJECT" "$DATASET" || echo "(dataset still missing — check execution logs)"
