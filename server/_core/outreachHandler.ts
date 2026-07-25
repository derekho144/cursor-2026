/**
 * outreachHandler.ts
 * Heartbeat handler for daily automated outreach
 * Runs every day at 9:00 AM UTC
 */

import { Request, Response } from 'express';
import { executeOutreachPipelineDemo, displayPreview } from '../scrapers/demoOutreachPipeline';
import { sdk } from './sdk';

export async function outreachHandler(req: Request, res: Response): Promise<void> {
  try {
    // Authenticate as cron
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      res.status(403).json({ error: 'cron-only' });
      return;
    }

    console.log(`\n[Heartbeat] Daily outreach job triggered at ${new Date().toISOString()}`);
    console.log(`Task UID: ${user.taskUid}`);

    // Execute the outreach pipeline
    const targets = await executeOutreachPipelineDemo();

    if (targets.length === 0) {
      console.log('[Heartbeat] No targets found');
      res.json({
        ok: true,
        message: 'No targets found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.log(`[Heartbeat] Found ${targets.length} outreach targets`);

    // Log preview
    displayPreview(targets);

    // TODO: Send emails
    // For now, just log the targets
    const emailsToSend = targets.filter((t) => t.decisionMaker.email);

    res.json({
      ok: true,
      message: `Daily outreach completed`,
      targetsFound: targets.length,
      emailsToSend: emailsToSend.length,
      timestamp: new Date().toISOString(),
      targets: targets.map((t) => ({
        company: t.company,
        jobTitle: t.jobTitle,
        decisionMaker: t.decisionMaker.name,
        email: t.decisionMaker.email,
      })),
    });
  } catch (error) {
    console.error('[Heartbeat] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        url: req.url,
        taskUid: (req as any).user?.taskUid,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
