/**
 * Fix Search #4 "指定目標缺少主要轉換動作".
 *
 * Root cause pattern: Maximize Conversions campaign whose conversion goals
 * do not include any primary conversion action (custom goal / wrong biddable
 * categories).
 *
 * Safe scope: conversion actions primaryForGoal + ConversionGoalCampaignConfig
 * + campaign_conversion_goal.biddable only. No budget/keyword/RSA/bidding-type.
 *
 * Usage (production env + Ads creds / DB refresh token):
 *   npx tsx scripts/google-ads-fix-search4-primary-conversion.ts --dry-run
 *   npx tsx scripts/google-ads-fix-search4-primary-conversion.ts --apply
 */
import {
  ensureUploadClickConversionAction,
  mutateGoogleAds,
  mutateGoogleAdsService,
  runGoogleAdsGaql,
} from "../server/googleAds";

const CUSTOMER = (process.env.GOOGLE_ADS_AD_ACCOUNT_ID ?? "4839352747").replace(
  /-/g,
  ""
);
const SEARCH4_ID = "24382201569";
const APPLY = process.argv.includes("--apply");

const INQUIRY_NAME = "JD Quote Inquiry (Offline)";
const ACCEPTED_NAME = "JD Quote Accepted (Offline)";

type AnyRow = Record<string, any>;

function pick(row: AnyRow, ...keys: string[]): any {
  for (const k of keys) {
    if (row[k] != null) return row[k];
  }
  // camelCase nested
  for (const k of keys) {
    const parts = k.split(".");
    let cur: any = row;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur == null) break;
    }
    if (cur != null) return cur;
  }
  return null;
}

async function diagnose() {
  const campaign = await runGoogleAdsGaql(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign.selective_optimization.conversion_actions
    FROM campaign
    WHERE campaign.id = ${SEARCH4_ID}
  `);

  const actions = await runGoogleAdsGaql(`
    SELECT
      conversion_action.id,
      conversion_action.resource_name,
      conversion_action.name,
      conversion_action.type,
      conversion_action.status,
      conversion_action.category,
      conversion_action.primary_for_goal
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `);

  const goals = await runGoogleAdsGaql(`
    SELECT
      campaign_conversion_goal.resource_name,
      campaign_conversion_goal.category,
      campaign_conversion_goal.origin,
      campaign_conversion_goal.biddable,
      campaign.id,
      campaign.name
    FROM campaign_conversion_goal
    WHERE campaign.id = ${SEARCH4_ID}
  `);

  const goalConfigs = await runGoogleAdsGaql(`
    SELECT
      conversion_goal_campaign_config.resource_name,
      conversion_goal_campaign_config.goal_config_level,
      conversion_goal_campaign_config.custom_conversion_goal,
      campaign.id,
      campaign.name
    FROM conversion_goal_campaign_config
    WHERE campaign.id = ${SEARCH4_ID}
  `);

  return { campaign, actions, goals, goalConfigs };
}

async function setPrimaryForGoal(resourceName: string) {
  // conversionActions:mutate update
  return mutateGoogleAdsService(
    // googleAds.ts types are narrow; cast through any for conversionActions
    "conversionActions" as any,
    [
      {
        update: {
          resourceName,
          primaryForGoal: true,
        },
        updateMask: "primaryForGoal",
      },
    ],
    !APPLY
  );
}

async function setGoalConfigCustomerLevel(resourceName: string) {
  return mutateGoogleAds(
    [
      {
        conversionGoalCampaignConfigOperation: {
          update: {
            resourceName,
            goalConfigLevel: "CUSTOMER",
          },
          updateMask: "goalConfigLevel",
        },
      },
    ],
    !APPLY
  );
}

async function setCampaignGoalBiddable(
  resourceName: string,
  biddable: boolean
) {
  return mutateGoogleAds(
    [
      {
        campaignConversionGoalOperation: {
          update: {
            resourceName,
            biddable,
          },
          updateMask: "biddable",
        },
      },
    ],
    !APPLY
  );
}

async function main() {
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        customer: CUSTOMER,
        campaignId: SEARCH4_ID,
      },
      null,
      2
    )
  );

  const before = await diagnose();
  console.log("BEFORE", JSON.stringify(before, null, 2));

  const inquiry = await ensureUploadClickConversionAction(
    INQUIRY_NAME,
    "SUBMIT_LEAD_FORM"
  );
  const accepted = await ensureUploadClickConversionAction(
    ACCEPTED_NAME,
    "PURCHASE"
  );
  console.log("ACTIONS", { inquiry, accepted });

  // Force primaryForGoal on both offline actions
  for (const rn of [inquiry, accepted]) {
    try {
      const r = await setPrimaryForGoal(rn);
      console.log("setPrimary", rn, r);
    } catch (e) {
      console.log("setPrimary_via_service_failed", String(e));
      // Fallback: googleAds:mutate conversionActionOperation
      const r = await mutateGoogleAds(
        [
          {
            conversionActionOperation: {
              update: { resourceName: rn, primaryForGoal: true },
              updateMask: "primaryForGoal",
            },
          },
        ],
        !APPLY
      );
      console.log("setPrimary_mutate", rn, r);
    }
  }

  // Prefer account-default goals on Search #4
  for (const row of before.goalConfigs) {
    const rn =
      pick(row, "conversionGoalCampaignConfig.resourceName") ||
      pick(row, "conversion_goal_campaign_config")?.resourceName;
    const level =
      pick(row, "conversionGoalCampaignConfig.goalConfigLevel") ||
      pick(row, "conversion_goal_campaign_config")?.goalConfigLevel;
    if (rn && level && String(level) !== "CUSTOMER") {
      console.log("switching_goal_config_to_CUSTOMER", rn, "from", level);
      const r = await setGoalConfigCustomerLevel(String(rn));
      console.log("goalConfigUpdate", r);
    }
  }

  // Ensure lead-form / purchase categories are biddable for Maximize Conversions
  const wantBiddable = new Set(["SUBMIT_LEAD_FORM", "PURCHASE", "CONTACT"]);
  const avoidAlone = new Set(["PAGE_VIEW", "ENGAGEMENT"]);
  for (const row of before.goals) {
    const rn =
      pick(row, "campaignConversionGoal.resourceName") ||
      pick(row, "campaign_conversion_goal")?.resourceName;
    const category =
      pick(row, "campaignConversionGoal.category") ||
      pick(row, "campaign_conversion_goal")?.category;
    const biddable =
      pick(row, "campaignConversionGoal.biddable") ??
      pick(row, "campaign_conversion_goal")?.biddable;
    if (!rn || !category) continue;
    const cat = String(category);
    if (wantBiddable.has(cat) && biddable === false) {
      console.log("enable_biddable", cat, rn);
      console.log(await setCampaignGoalBiddable(String(rn), true));
    }
    // Do not blindly disable others — only log
    if (avoidAlone.has(cat) && biddable === true) {
      console.log("note_biddable_soft_signal", cat, rn);
    }
  }

  const after = await diagnose();
  console.log("AFTER", JSON.stringify(after, null, 2));

  // Summary for operators
  const primaryActions = after.actions.filter((r) => {
    const name = pick(r, "conversionAction.name") || pick(r, "conversion_action")?.name;
    const primary =
      pick(r, "conversionAction.primaryForGoal") ??
      pick(r, "conversion_action")?.primaryForGoal;
    return (
      (name === INQUIRY_NAME || name === ACCEPTED_NAME) &&
      (primary === true || primary === "true")
    );
  });
  console.log(
    "SUMMARY",
    JSON.stringify(
      {
        applied: APPLY,
        primaryOfflineActions: primaryActions.length,
        goalConfigs: after.goalConfigs.length,
        campaignGoals: after.goals.map((r) => ({
          category:
            pick(r, "campaignConversionGoal.category") ||
            pick(r, "campaign_conversion_goal")?.category,
          biddable:
            pick(r, "campaignConversionGoal.biddable") ??
            pick(r, "campaign_conversion_goal")?.biddable,
          resource:
            pick(r, "campaignConversionGoal.resourceName") ||
            pick(r, "campaign_conversion_goal")?.resourceName,
        })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
