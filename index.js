require('dotenv').config();

const axios = require('axios');
const { App } = require('@slack/bolt');
const { SLACK_BOT_TOKEN, DEEPSEEK_API_KEY, SLACK_APP_TOKEN } = process.env;

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
    let htmlContent = res.data;

    htmlContent = htmlContent.replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gim,
      ''
    );
    htmlContent = htmlContent.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, '');
    policyText = htmlContent.replace(/<[^>]+>/g, ' ');
    policyText = policyText.replace(/\{"@context":[\s\S]*?\}\s*/gm, '');
    policyText = policyText.replace(/\s+/g, ' ').trim();

    console.log(`Context loaded. Text size:  ${policyText.length} characters.`);
  } catch (error) {
    console.error('Error loading or clearing policy:', error.message);
  }
}

async function getDeepSeekAnswer (question) {
  const response = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            'You are an HR assistant. Use only text from the holiday policy provided by the user to answer the question.',
        },
        {
          role: 'user',
          content: `Company Policy: ${policyText}\n\nUser Question: ${question}`,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.choices[0].message.content;
}

async function handleDeepSeekError (error, say) {
  console.error(error.response?.data);
  console.error(error.message);

  const deepSeekMessage = error.response?.data?.error?.message;
  let errorMessage;

  if (deepSeekMessage) {
    errorMessage = deepSeekMessage;
  } else if (error.message.includes('402')) {
    errorMessage = 'Payment Required (Insufficient Balance)';
  } else {
    errorMessage = error.message;
  }

  await say(
    `An error occurred while receiving a response from DeepSeek: ${errorMessage}`
  );
}

app.event('app_mention', async ({ event, say }) => {
  const question = event.text.replace(/<@[^>]+>/, '').trim();

  try {
    const answer = await getDeepSeekAnswer(question);
    await say(answer);
  } catch (error) {
    await handleDeepSeekError(error, say);
  }
});

app.message(/.*/, async ({ message, say }) => {
  const question = message.text.trim();

  if (message.subtype === 'bot_message' || message.user === app.botUserId) {
    return;
  }

  try {
    const answer = await getDeepSeekAnswer(question);
    await say(answer);
  } catch (error) {
    await handleDeepSeekError(error, say);
  }
});

(async () => {
  try {
    await loadPolicy();
    await app.start();
    console.log('Slack AI Assistant is running!');
  } catch (error) {
    console.error('Error when starting the application:', error);
  }
})();
