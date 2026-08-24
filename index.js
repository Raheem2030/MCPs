const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();

// إعدادات CORS وتسهيل الاتصالات الخارجية
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// تعريف خادم MCP
const server = new Server(
  { name: 'research-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// قائمة الأدوات المتاحة
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
    },
    {
      name: 'search_pubmed',
      description: 'البحث في قاعدة البيانات الطبية PubMed (تتضمن مراجعات Cochrane)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'كلمات البحث الطبية' },
          limit: { type: 'number', description: 'عدد النتائج' }
        },
        required: ['query']
      }
    },
    {
      name: 'search_openalex',
      description: 'البحث في OpenAlex للأبحاث العلمية الأكاديمية الشاملة',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'عنوان البحث أو موضوع البحث العلمى' },
          limit: { type: 'number', description: 'عدد الأبحاث' }
        },
        required: ['query']
      }
    }
  ]
}));

// معالجة طلبات الأدوات
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'send_telegram_message') {
    if (!bot) throw new Error('Telegram Bot Token غير مضبوط');
    await bot.sendMessage(args.chatId, args.message);
    return { content: [{ type: 'text', text: `تم إرسال الرسالة بنجاح إلى ${args.chatId}` }] };
  }

  if (name === 'search_pubmed') {
    const limit = args.limit || 5;
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(args.query)}&retmode=json&retmax=${limit}`;
    const searchRes = await fetch(searchUrl).then(r => r.json());
    const idList = searchRes.esearchresult?.idlist || [];

    if (idList.length === 0) {
      return { content: [{ type: 'text', text: 'لم يتم العثور على أبحاث في PubMed لهذا البحث.' }] };
    }

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idList.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl).then(r => r.json());
    const results = idList.map(id => {
      const item = summaryRes.result[id];
      return `- **${item.title}**\n  المجلة: ${item.source} (${item.pubdate})\n  الرابط: https://pubmed.ncbi.nlm.nih.gov/${id}/`;
    }).join('\n\n');

    return { content: [{ type: 'text', text: `نتائج PubMed:\n\n${results}` }] };
  }

  if (name === 'search_openalex') {
    const limit = args.limit || 5;
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(args.query)}&per-page=${limit}`;
    const res = await fetch(url).then(r => r.json());
    const works = res.results || [];

    if (works.length === 0) {
      return { content: [{ type: 'text', text: 'لم يتم العثور على أبحاث في OpenAlex.' }] };
    }

    const results = works.map(w => {
      const year = w.publication_year || 'N/A';
      const doi = w.doi || w.id;
      return `- **${w.title}** (${year})\n  عدد الاستشهادات: ${w.cited_by_count}\n  الرابط: ${doi}`;
    }).join('\n\n');

    return { content: [{ type: 'text', text: `نتائج OpenAlex:\n\n${results}` }] };
  }

  throw new Error('Tool not found');
});

// إدارة الاتصال عبر SSE بمرونة عالية
let transport = null;

app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/message', res);
  await server.connect(transport);
});

app.post('/message', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active SSE connection');
  }
});

app.get('/', (req, res) => {
  res.send('MCP Server is Ready');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
