const axios = require('axios');
const { App } = require('@slack/bolt');

require('dotenv').config();

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, OPENAI_API_KEY } = process.env;

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

const POLICY_URL = 'https://resources.workable.com/company-holiday-policy';
let policyText = '';

async function loadPolicy () {
  try {
    const res = await axios.get(POLICY_URL);
    let html = res.data;
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gim, '');
    html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, '');
    let text = html.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\{"@context":[\s\S]*?\}\s*/gm, '');
    text = text.replace(/\s+/g, ' ').trim();

    const startKey = 'Policy brief & purpose';
    const idx = text.indexOf(startKey);
    if (idx > -1) {
      text = text.substring(idx);
    }

    policyText = text;
  } catch (err) {
    console.error('Error loading policy:', err.message);
  }
}

async function askOpenAI (question) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'HTTP-Referer': 'Slack-AI-Assistant',
    'X-Title': 'Slack HR Assistant',
  };

  const body = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful HR assistant. Use ONLY the provided company policy. If the answer is not found — say you cannot find it.',
      },
      {
        role: 'user',
        content: `Company Policy: ${policyText}\n\nUser question: ${question}`,
      },
    ],
    max_tokens: 500,
    temperature: 0.3,
  };

  try {
    const res = await axios.post(url, body, { headers });
    const data = res.data;
    const answer =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      data?.output_text ||
      'No response from model';

    return answer.trim();
  } catch (err) {
    console.error('AI API error:', err.response?.data || err.message);
    throw new Error(
      err.response?.data?.error?.message ||
        err.message ||
        'Unknown OpenRouter API error'
    );
  }
}

async function handleError (err, say) {
  console.error(err.response?.data || err.message);
  const msg = err.response?.data?.error?.message || err.message;
  await say(`Error when querying AI: ${msg}`);
}

app.event('app_mention', async ({ event, say }) => {
  const question = event.text.replace(/<@[^>]+>/, '').trim();
  try {
    const answer = await askOpenAI(question);
    await say(answer);
  } catch (err) {
    await handleError(err, say);
  }
});

app.message(/.*/, async ({ message, say }) => {
  if (message.subtype === 'bot_message' || message.user === undefined) {
    return;
  }
  const question = message.text.trim();
  try {
    const answer = await askOpenAI(question);
    await say(answer);
  } catch (err) {
    await handleError(err, say);
  }
});

(async () => {
  await loadPolicy();
  await app.start();
  console.log('Slack HR assistant is up');
})();
