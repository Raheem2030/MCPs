const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();

// إعدادات CORS لتسمح لـ Gemini Spark بالاتصال
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

const server = new Server(
  { name: 'telegram-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_telegram_message',
      description: 'إرسال رسالة عبر بوت التليجرام',
      inputSchema: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'معرف المحادثة Chat ID' },
          message: { type: 'string', description: 'نص الرسالة' }
        },
        required: ['chatId', 'message']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'send_telegram_message') {
    const { chatId, message } = request.params.arguments;
    if (bot) {
      await bot.sendMessage(chatId, message);
      return { content: [{ type: 'text', text: `تم إرسال الرسالة بنجاح إلى ${chatId}` }] };
    }
    throw new Error('Telegram Bot Token غير مضبوط');
  }
  throw new Error('Tool not found');
});

const transports = new Map();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  transports.set(transport.sessionId, transport);
  
  res.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId) || Array.from(transports.values())[0];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active SSE session found');
  }
});

app.get('/', (req, res) => {
  res.send('Telegram MCP Server is Running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
