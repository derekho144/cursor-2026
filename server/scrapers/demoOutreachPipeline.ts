/**
 * demoOutreachPipeline.ts
 * 演示客戶開拓管道 - 使用真實的職位數據
 * 基於 CTgoodjobs 郵件中找到的職位
 */

import { invokeLLM } from '../_core/llm';

export interface JobListing {
  title: string;
  company: string;
  location: string;
  platform: string;
}

export interface DecisionMaker {
  name: string;
  title: string;
  email?: string;
}

export interface OutreachTarget {
  company: string;
  jobTitle: string;
  location: string;
  decisionMaker: DecisionMaker;
  emailDraft: string;
  subject: string;
}

/**
 * 真實職位數據（從各平台收集）
 */
const REAL_JOBS: JobListing[] = [
  {
    title: 'Photographer 攝影師 (Full-Time / Part-Time)',
    company: 'Petits Photography',
    location: 'Hong Kong',
    platform: 'CTgoodjobs',
  },
  {
    title: 'Photographer/Videographer and AI editor',
    company: 'Miss Amara',
    location: 'Hong Kong',
    platform: 'LinkedIn',
  },
  {
    title: '2D & 3D Photographer',
    company: 'Wellcom Worldwide',
    location: 'Hong Kong',
    platform: 'LinkedIn',
  },
  {
    title: 'Conservator, Photography, M+ Museum',
    company: 'West Kowloon Cultural District Authority',
    location: 'Hong Kong',
    platform: 'LinkedIn',
  },
  {
    title: '攝影記者 Photographer',
    company: 'Hk01',
    location: 'Hong Kong',
    platform: 'LinkedIn',
  },
];

/**
 * 模擬決策者數據（實際應用中應從 LinkedIn 爬取）
 */
const MOCK_DECISION_MAKERS: { [key: string]: DecisionMaker[] } = {
  'petits photography': [
    { name: 'Peter Wong', title: 'Founder & CEO', email: 'peter@petitsphotography.com' },
    { name: 'Emily Chen', title: 'HR Manager', email: 'emily@petitsphotography.com' },
  ],
  'miss amara': [
    { name: 'Amara Lee', title: 'Founder & CEO', email: 'amara@missamara.com' },
    { name: 'David Lau', title: 'Creative Director', email: 'david@missamara.com' },
  ],
  'wellcom worldwide': [
    { name: 'James Wong', title: 'Managing Director', email: 'james@wellcom.hk' },
    { name: 'Lisa Chan', title: 'Head of HR', email: 'lisa@wellcom.hk' },
  ],
  'west kowloon cultural district authority': [
    { name: 'Dr. Margaret Leung', title: 'Director', email: 'margaret@westkowloon.hk' },
    { name: 'Robert Tse', title: 'Head of Curatorial', email: 'robert@westkowloon.hk' },
  ],
  'hk01': [
    { name: 'Zhang Wei', title: 'CEO', email: 'zhang@hk01.com' },
    { name: 'Susan Ho', title: 'Editor-in-Chief', email: 'susan@hk01.com' },
  ],
};

/**
 * 生成個性化 pitch email
 */
async function generatePitchEmail(
  company: string,
  jobTitle: string,
  decisionMaker: DecisionMaker
): Promise<{ subject: string; body: string }> {
  try {
    const prompt = `
Generate a professional and personalized pitch email for a photography/videography services company (JD STUDIO HK) reaching out to a decision maker.

Company: ${company}
Job Title: ${jobTitle}
Decision Maker: ${decisionMaker.name}
Decision Maker Title: ${decisionMaker.title}

The email should:
1. Address the decision maker by name and title
2. Reference the photographer/videographer position they're hiring for
3. Explain how JD STUDIO HK can help with their photography/videography needs
4. Mention specific services (product photography, event coverage, video production, etc.)
5. Include a call to action (meeting request)
6. Be professional but friendly
7. Be concise (under 150 words)

Return the email in this format:
SUBJECT: [email subject line]

BODY:
[email body]
`;

    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content:
            'You are a professional copywriter for JD STUDIO HK, a photography and videography services company based in Hong Kong. Generate personalized pitch emails that are engaging, professional, and persuasive.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content =
      typeof response.choices[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : '';

    // 解析 subject 和 body
    const lines = content.split('\n');
    let subject = '';
    let body = '';
    let inBody = false;

    for (const line of lines) {
      if (line.startsWith('SUBJECT:')) {
        subject = line.replace('SUBJECT:', '').trim();
      } else if (line.startsWith('BODY:')) {
        inBody = true;
      } else if (inBody && line.trim()) {
        body += (body ? '\n' : '') + line;
      }
    }

    return {
      subject: subject || `Regarding your ${jobTitle} position at ${company}`,
      body: body || content,
    };
  } catch (error) {
    console.error('✗ Error generating pitch:', error);
    return {
      subject: `Exploring a creative partnership for ${company}`,
      body: `Dear ${decisionMaker.name},\n\nWe are JD STUDIO HK, a professional photography and videography services company. We noticed your company is hiring for a ${jobTitle} position and would like to discuss how we can support your visual content needs.\n\nBest regards,\nDerek\nJD STUDIO HK\nTel: (852) 9153 1976`,
    };
  }
}

/**
 * 執行完整管道（預覽模式）
 */
export async function executeOutreachPipelineDemo(): Promise<OutreachTarget[]> {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  COMPLETE OUTREACH PIPELINE - DEMO MODE                   ║');
  console.log('║  Real job data + AI-generated personalized emails         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const targets: OutreachTarget[] = [];

  try {
    console.log(`📊 Step 1: Found ${REAL_JOBS.length} photographer/videographer positions\n`);

    // 為每個職位生成 outreach targets
    for (const job of REAL_JOBS) {
      const makers = MOCK_DECISION_MAKERS[job.company.toLowerCase()] || [];

      if (makers.length === 0) {
        console.log(`⚠️  No decision makers found for ${job.company}`);
        continue;
      }

      // 使用優先級最高的決策者（CEO/Founder）
      const topMaker = makers[0];
      console.log(`🔍 Generating pitch for ${topMaker.name} (${topMaker.title}) @ ${job.company}...`);

      const { subject, body } = await generatePitchEmail(job.company, job.title, topMaker);

      targets.push({
        company: job.company,
        jobTitle: job.title,
        location: job.location,
        decisionMaker: topMaker,
        emailDraft: body,
        subject,
      });

      console.log(`✓ Generated pitch email\n`);
    }

    console.log(`✓ Generated ${targets.length} personalized pitch emails\n`);
  } catch (error) {
    console.error('✗ Pipeline error:', error);
  }

  return targets;
}

/**
 * 顯示預覽
 */
export function displayPreview(targets: OutreachTarget[]): void {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  PREVIEW: DECISION MAKERS & EMAIL DRAFTS                  ║');
  console.log('║  Ready for your review before sending                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  targets.forEach((target, index) => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📌 TARGET #${index + 1} of ${targets.length}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`🏢 Company: ${target.company}`);
    console.log(`📍 Location: ${target.location}`);
    console.log(`💼 Job Title: ${target.jobTitle}`);
    console.log(`\n👤 Decision Maker:`);
    console.log(`   Name: ${target.decisionMaker.name}`);
    console.log(`   Title: ${target.decisionMaker.title}`);
    console.log(`   Email: ${target.decisionMaker.email || '❌ Not found'}`);
    console.log(`\n📧 Email Draft:`);
    console.log(`   Subject: "${target.subject}"`);
    console.log(`\n   Body:`);
    const bodyLines = target.emailDraft.split('\n');
    bodyLines.forEach((line) => {
      console.log(`   ${line}`);
    });
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✓ PREVIEW COMPLETE`);
  console.log(`═`.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Total targets: ${targets.length}`);
  console.log(`   Ready to send: ${targets.filter((t) => t.decisionMaker.email).length}`);
  console.log(`   Missing emails: ${targets.filter((t) => !t.decisionMaker.email).length}`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Review the email drafts above`);
  console.log(`   2. Confirm decision maker information`);
  console.log(`   3. Approve sending or make adjustments`);
  console.log(`\n${'═'.repeat(60)}\n`);
}
