/**
 * Example: Seed users and memories, then perform similarity searches
 * Run with: bun example/seed-and-search.ts
 */

import db from "../src/db/index";
import { user } from "../src/db/schema";
import { inArray } from "drizzle-orm";
import {
  createMemories,
  searchSimilarMemories,
  listMemories,
  getTopMemories,
  type CreateMemoryInput,
} from "../src/db/memory";

// ============
// Cleanup Functions
// ============

async function cleanupTestData() {
  log("🧹 Cleaning up existing test data");

  // Delete test users (cascade will delete memories)
  const testEmails = ["a@example.com", "b@example.com", "c@example.com"];

  const deleted = await db
    .delete(user)
    .where(inArray(user.email, testEmails))
    .returning({ id: user.id });

  console.log(`✅ Deleted ${deleted.length} test users and their memories`);
}

// ============
// Helper Functions
// ============

function log(message: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${message}`);
  console.log("=".repeat(60));
}

// ============
// Seed Data
// ============

async function seedUsers() {
  log("🌱 Seeding Test Users");

  // Create test users with single character names
  const users = [
    {
      name: "A",
      email: "a@example.com",
      preferences: { theme: "dark", language: "zh" },
    },
    {
      name: "B",
      email: "b@example.com",
      preferences: { theme: "light", language: "en" },
    },
    {
      name: "C",
      email: "c@example.com",
      preferences: { theme: "dark", language: "es" },
    },
  ];

  const createdUsers = [];

  for (const userData of users) {
    const [created] = await db
      .insert(user)
      .values(userData)
      .returning({ id: user.id, name: user.name, email: user.email });

    if (created) {
      createdUsers.push(created);
      console.log(`✅ Created user: ${created.name} (${created.email})`);
    }
  }

  return createdUsers;
}

async function seedMemories(userId: string, userName: string) {
  log(`🌱 Seeding Memories for ${userName}`);

  let memories: Omit<CreateMemoryInput, "userId">[] = [];

  // A - Software Engineer focused on AI/ML (中文内容)
  if (userName === "A") {
    memories = [
      // USER_FACTS
      {
        category: "USER_FACTS",
        content:
          "A 是一位资深软件工程师，专注于机器学习和人工智能系统。她有8年的工作经验，目前在一家科技创业公司工作，负责构建对话式AI系统。",
        summary: "资深机器学习工程师，8年AI领域经验",
        importanceScore: 9.5,
        confidenceScore: 1.0,
        emotionalWeight: 3,
      },
      {
        category: "USER_FACTS",
        content:
          "A 毕业于斯坦福大学计算机科学硕士，专注于自然语言处理方向。她在读期间发表了3篇学术论文。",
        summary: "斯坦福大学计算机硕士，NLP方向，发表3篇论文",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "USER_FACTS",
        content:
          "A 精通英语和中文。她经常阅读两种语言的研究论文，并为开源项目做出贡献。",
        summary: "中英双语，开源项目贡献者",
        importanceScore: 7.0,
        confidenceScore: 1.0,
        emotionalWeight: 1.5,
      },
      {
        category: "USER_FACTS",
        content:
          "A 在分布式系统方面有丰富经验，曾负责将机器学习推理管道扩展到每天处理数百万次请求。",
        summary: "分布式系统专家，扩展ML推理管道",
        importanceScore: 8.5,
        confidenceScore: 0.95,
        emotionalWeight: 2,
      },

      // USER_PREFERENCES
      {
        category: "USER_PREFERENCES",
        content:
          "A 偏好使用 Python 和 TypeScript 进行开发。她喜欢使用现代框架，比如前端用 React 和 Next.js，后端用 FastAPI 或 Express。",
        summary: "偏好 Python、TypeScript、React、Next.js、FastAPI",
        importanceScore: 8.0,
        confidenceScore: 0.95,
        emotionalWeight: 2,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "A 偏好异步沟通方式，重视深度工作时间。她觉得会议很消耗精力，更喜欢书面文档形式的交流。",
        summary: "偏好异步沟通、深度工作、书面文档",
        importanceScore: 7.5,
        confidenceScore: 0.9,
        emotionalWeight: 2.5,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "A 喜欢极简主义的 UI 设计，总是使用深色模式。她对代码格式化很讲究，坚持使用 Prettier 和 ESLint。",
        summary: "深色模式、极简UI、严格代码格式化",
        importanceScore: 6.5,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "A 对于关系型数据偏好使用 PostgreSQL，缓存使用 Redis。她最近在探索 SQLite 在边缘计算场景下的应用。",
        summary: "偏好 PostgreSQL、Redis，探索 SQLite",
        importanceScore: 7.0,
        confidenceScore: 0.9,
        emotionalWeight: 1.5,
      },

      // USER_GOALS
      {
        category: "USER_GOALS",
        content:
          "A 想要构建一个具有高级记忆能力的 AI 助手，能够跨对话记住上下文并从用户交互中随时间学习。",
        summary: "构建具有记忆功能的AI助手",
        importanceScore: 9.8,
        confidenceScore: 1.0,
        emotionalWeight: 4,
      },
      {
        category: "USER_GOALS",
        content:
          "A 的目标是在明年内成为技术负责人。她想要指导初级工程师并引导架构决策。",
        summary: "成为技术负责人，指导工程师",
        importanceScore: 9.0,
        confidenceScore: 0.95,
        emotionalWeight: 3.5,
      },
      {
        category: "USER_GOALS",
        content:
          "A 想要在 NeurIPS 或 ICML 等顶级会议上发表关于 AI 助手中高效上下文管理的论文。",
        summary: "在 NeurIPS 或 ICML 上发表论文",
        importanceScore: 8.8,
        confidenceScore: 0.85,
        emotionalWeight: 4,
      },
      {
        category: "USER_GOALS",
        content:
          "A 正在努力提高她的公开演讲技能。她想在大型技术会议上做关于 AI 记忆系统的演讲。",
        summary: "提高演讲技能，在会议上分享AI记忆系统",
        importanceScore: 7.5,
        confidenceScore: 0.8,
        emotionalWeight: 3,
      },

      // EPISODIC_EVENTS
      {
        category: "EPISODIC_EVENTS",
        content:
          "上周，A 成功使用 SQLite-vec 实现了向量数据库以进行语义搜索。她对相似度搜索的速度感到非常兴奋。",
        summary: "实现了 SQLite-vec 语义搜索",
        importanceScore: 7.5,
        confidenceScore: 1.0,
        emotionalWeight: 3.5,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "昨天，A 花了6个小时调试嵌入服务中的内存泄漏问题。她最终追踪到是 PyTorch 中不当的张量清理导致的。",
        summary: "调试嵌入服务的内存泄漏问题",
        importanceScore: 6.5,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "上周五，A 向团队展示了她的 AI 助手原型。大家对上下文记忆能力印象深刻，并提出了很多好问题。",
        summary: "向团队展示AI助手原型",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 4,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "两周前，A 参加了一个 AI 会议，学习了新的 RAG 技术和向量搜索优化方法。她做了大量笔记。",
        summary: "参加AI会议，学习RAG和向量搜索",
        importanceScore: 7.8,
        confidenceScore: 1.0,
        emotionalWeight: 3,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "今天 A 与她的经理进行了一对一沟通。他们讨论了她的晋升路径，并就下个季度的具体里程碑达成了一致。",
        summary: "与经理一对一讨论晋升事宜",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 3.5,
      },

      // CONTEXT_PATTERNS
      {
        category: "CONTEXT_PATTERNS",
        content:
          "A 通常在晚上编程，时间在晚上8点到午夜之间。这是她效率最高的时段，她偏好在这段时间里不被打扰。",
        summary: "晚上8点到午夜效率最高",
        importanceScore: 6.5,
        confidenceScore: 0.9,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "A 每天早上喝咖啡的时候审查 PR。她很细致，总是给出建设性的反馈。",
        summary: "早上喝咖啡时审查PR",
        importanceScore: 5.5,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "A 倾向于并行开发多个功能。她广泛使用功能分支，并合并小的增量更改。",
        summary: "并行开发多个功能，小步快跑",
        importanceScore: 6.0,
        confidenceScore: 0.9,
        emotionalWeight: 0.5,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "A 遇到难题时，她会去散步或快速锻炼一下。身体活动帮助她思考复杂的挑战。",
        summary: "遇到难题时散步或锻炼",
        importanceScore: 5.0,
        confidenceScore: 0.85,
        emotionalWeight: 1.5,
      },
    ];
  }

  // B - Product Manager interested in AI
  if (userName === "B") {
    memories = [
      // USER_FACTS
      {
        category: "USER_FACTS",
        content:
          "Bob is a product manager with a background in computer science. He's passionate about AI and how it can improve user experiences.",
        summary: "Product manager with CS background, passionate about AI",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "USER_FACTS",
        content:
          "Bob has 6 years of PM experience at various startups. He previously worked as a software engineer for 3 years before transitioning to product.",
        summary: "6 years PM experience, former software engineer",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 1.5,
      },
      {
        category: "USER_FACTS",
        content:
          "Bob graduated from UC Berkeley with a degree in Computer Science. He was involved in several entrepreneurial ventures during college.",
        summary: "UC Berkeley CS grad, entrepreneurial background",
        importanceScore: 7.0,
        confidenceScore: 1.0,
        emotionalWeight: 1,
      },
      {
        category: "USER_FACTS",
        content:
          "Bob has launched 5 major features in his career, with 3 of them becoming flagship products. He has a strong track record of product success.",
        summary: "Launched 5 features, 3 became flagship products",
        importanceScore: 8.5,
        confidenceScore: 0.95,
        emotionalWeight: 2.5,
      },
      {
        category: "USER_FACTS",
        content:
          "Bob is certified in Product Management by Pragmatic Institute and regularly attends PM workshops and conferences.",
        summary: "Pragmatic Institute certified, attends PM conferences",
        importanceScore: 6.5,
        confidenceScore: 1.0,
        emotionalWeight: 1,
      },

      // USER_PREFERENCES
      {
        category: "USER_PREFERENCES",
        content:
          "Bob prefers clear documentation and well-structured APIs. He appreciates when technical concepts are explained in simple terms.",
        summary: "Values clear docs and simple explanations",
        importanceScore: 7.0,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Bob likes data-driven decision making. He always asks for metrics, A/B test results, and user feedback before committing to features.",
        summary: "Data-driven, values metrics and user feedback",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Bob prefers Notion for documentation, Figma for design collaboration, and Linear for project management. He's very organized.",
        summary: "Uses Notion, Figma, Linear; very organized",
        importanceScore: 6.0,
        confidenceScore: 0.9,
        emotionalWeight: 0.5,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Bob prefers morning standup meetings and afternoon deep work sessions. He blocks his calendar from 2-5 PM for focused time.",
        summary: "Morning standups, afternoon deep work 2-5 PM",
        importanceScore: 6.5,
        confidenceScore: 0.9,
        emotionalWeight: 1,
      },

      // USER_GOALS
      {
        category: "USER_GOALS",
        content:
          "Bob wants to launch a new AI-powered feature that helps users organize their tasks intelligently based on context and priorities.",
        summary: "Launching AI task organization feature",
        importanceScore: 9.0,
        confidenceScore: 1.0,
        emotionalWeight: 3,
      },
      {
        category: "USER_GOALS",
        content:
          "Bob aims to grow the user base by 50% over the next two quarters through strategic feature releases and partnerships.",
        summary: "Growing user base 50% through features and partnerships",
        importanceScore: 9.2,
        confidenceScore: 0.9,
        emotionalWeight: 3.5,
      },
      {
        category: "USER_GOALS",
        content:
          "Bob wants to build a world-class product team. He's planning to hire 2 PMs and 3 designers in the next 6 months.",
        summary: "Building product team, hiring 2 PMs and 3 designers",
        importanceScore: 8.5,
        confidenceScore: 0.85,
        emotionalWeight: 3,
      },
      {
        category: "USER_GOALS",
        content:
          "Bob is working towards becoming a VP of Product within 2 years. He's taking leadership courses and seeking mentorship from senior leaders.",
        summary: "Becoming VP of Product, taking leadership courses",
        importanceScore: 9.0,
        confidenceScore: 0.8,
        emotionalWeight: 4,
      },

      // EPISODIC_EVENTS
      {
        category: "EPISODIC_EVENTS",
        content:
          "Yesterday, Bob had a great meeting with the engineering team discussing the architecture for the new AI feature. Everyone was aligned on the approach.",
        summary: "Productive meeting about AI feature architecture",
        importanceScore: 7.0,
        confidenceScore: 1.0,
        emotionalWeight: 2.5,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Last week, Bob conducted 10 user interviews to gather feedback on the new AI task organizer. The feedback was overwhelmingly positive.",
        summary: "Conducted 10 user interviews, positive feedback",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 3,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Bob presented the Q3 roadmap to executives yesterday. They approved all major initiatives and allocated additional budget for AI features.",
        summary: "Q3 roadmap approved by executives",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 4,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Two days ago, Bob ran a successful product workshop with the team. They brainstormed 30 new feature ideas and prioritized the top 10.",
        summary: "Product workshop, 30 ideas brainstormed",
        importanceScore: 6.5,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Bob attended a PM summit last month where he networked with 50+ product leaders and learned about emerging AI trends in product management.",
        summary: "PM summit, networked with 50+ leaders",
        importanceScore: 7.5,
        confidenceScore: 1.0,
        emotionalWeight: 2.5,
      },

      // CONTEXT_PATTERNS
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Bob starts every Monday with a team sync to align on weekly priorities. He finds this helps everyone stay focused.",
        summary: "Monday team syncs for weekly alignment",
        importanceScore: 6.0,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Bob reviews analytics dashboards every morning and shares key insights with the team in Slack. He's very data-conscious.",
        summary: "Morning analytics review, shares insights in Slack",
        importanceScore: 6.5,
        confidenceScore: 0.9,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Bob typically schedules user interviews on Tuesdays and Thursdays. He prefers back-to-back sessions to stay in the research mindset.",
        summary: "User interviews on Tuesdays and Thursdays",
        importanceScore: 5.5,
        confidenceScore: 0.9,
        emotionalWeight: 0.5,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "When making tough decisions, Bob creates a simple pros/cons doc and shares it with stakeholders for input before deciding.",
        summary: "Creates pros/cons docs for tough decisions",
        importanceScore: 6.0,
        confidenceScore: 0.85,
        emotionalWeight: 1,
      },
    ];
  }

  // C - Data Scientist
  if (userName === "C") {
    memories = [
      // USER_FACTS
      {
        category: "USER_FACTS",
        content:
          "Carol is a data scientist specializing in natural language processing and embeddings. She has a PhD in computational linguistics from MIT.",
        summary:
          "Data scientist, NLP specialist, PhD in comp linguistics from MIT",
        importanceScore: 9.0,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "USER_FACTS",
        content:
          "Carol has published 12 papers in top-tier conferences including ACL, EMNLP, and NeurIPS. Her work focuses on semantic similarity and information retrieval.",
        summary: "12 publications in ACL, EMNLP, NeurIPS",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 2.5,
      },
      {
        category: "USER_FACTS",
        content:
          "Carol is proficient in Python, R, and Julia. She's an expert in PyTorch, TensorFlow, and scikit-learn for machine learning tasks.",
        summary:
          "Proficient in Python, R, Julia; expert in PyTorch, TensorFlow",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 1.5,
      },
      {
        category: "USER_FACTS",
        content:
          "Carol has 5 years of industry experience after completing her PhD. She previously worked at Google Research on language understanding.",
        summary: "5 years industry experience, former Google Research",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 2,
      },
      {
        category: "USER_FACTS",
        content:
          "Carol is trilingual, speaking English, Spanish, and Portuguese fluently. This helps her work on multilingual NLP projects.",
        summary: "Trilingual: English, Spanish, Portuguese",
        importanceScore: 7.0,
        confidenceScore: 1.0,
        emotionalWeight: 1,
      },

      // USER_PREFERENCES
      {
        category: "USER_PREFERENCES",
        content:
          "Carol loves experimenting with different embedding models. She's currently comparing OpenAI's embeddings with open-source alternatives like Qwen and BGE.",
        summary: "Experimenting with embedding models (OpenAI, Qwen, BGE)",
        importanceScore: 8.5,
        confidenceScore: 0.9,
        emotionalWeight: 3,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Carol prefers Jupyter notebooks for exploratory analysis and Python scripts for production code. She's meticulous about version control.",
        summary: "Jupyter for exploration, Python scripts for production",
        importanceScore: 7.0,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Carol likes to visualize everything. She uses matplotlib, seaborn, and plotly extensively to understand data distributions and model behavior.",
        summary: "Loves visualizations, uses matplotlib, seaborn, plotly",
        importanceScore: 6.5,
        confidenceScore: 0.9,
        emotionalWeight: 2,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Carol prefers asynchronous collaboration and detailed documentation. She maintains a research journal where she logs all experiments.",
        summary: "Async collaboration, maintains research journal",
        importanceScore: 7.0,
        confidenceScore: 0.9,
        emotionalWeight: 1.5,
      },
      {
        category: "USER_PREFERENCES",
        content:
          "Carol uses Weights & Biases for experiment tracking and loves the ability to compare runs side-by-side. She's very organized with her ML experiments.",
        summary: "Uses W&B for experiment tracking, very organized",
        importanceScore: 6.5,
        confidenceScore: 0.85,
        emotionalWeight: 1,
      },

      // USER_GOALS
      {
        category: "USER_GOALS",
        content:
          "Carol aims to publish a paper on efficient vector search techniques for large-scale semantic similarity applications at NeurIPS 2025.",
        summary: "Publishing paper on vector search at NeurIPS 2025",
        importanceScore: 9.5,
        confidenceScore: 1.0,
        emotionalWeight: 4,
      },
      {
        category: "USER_GOALS",
        content:
          "Carol wants to build an open-source library for semantic search that's faster and more accurate than existing solutions like FAISS.",
        summary: "Building open-source semantic search library",
        importanceScore: 9.0,
        confidenceScore: 0.9,
        emotionalWeight: 4,
      },
      {
        category: "USER_GOALS",
        content:
          "Carol is working towards becoming a principal scientist. She wants to lead a research team focused on information retrieval and semantic understanding.",
        summary: "Becoming principal scientist, leading IR research team",
        importanceScore: 9.2,
        confidenceScore: 0.85,
        emotionalWeight: 3.5,
      },
      {
        category: "USER_GOALS",
        content:
          "Carol wants to give a keynote talk at ACL or EMNLP about the future of semantic search and embedding models.",
        summary: "Keynote at ACL/EMNLP on semantic search future",
        importanceScore: 8.5,
        confidenceScore: 0.75,
        emotionalWeight: 3,
      },

      // EPISODIC_EVENTS
      {
        category: "EPISODIC_EVENTS",
        content:
          "Carol discovered that using 4096-dimensional embeddings provides a good balance between accuracy and performance for her use case. She ran 50 experiments to validate this.",
        summary: "Found 4096-dim embeddings optimal after 50 experiments",
        importanceScore: 7.8,
        confidenceScore: 0.95,
        emotionalWeight: 2,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Last week, Carol's paper on multilingual embeddings was accepted to EMNLP 2025. She's thrilled and planning to present in person.",
        summary: "Paper accepted to EMNLP 2025",
        importanceScore: 9.0,
        confidenceScore: 1.0,
        emotionalWeight: 5,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Yesterday, Carol optimized the vector search pipeline and achieved a 3x speedup by using batch processing and caching strategies.",
        summary: "Optimized vector search, 3x speedup",
        importanceScore: 8.0,
        confidenceScore: 1.0,
        emotionalWeight: 3.5,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Carol gave a tech talk internally last Friday about semantic search best practices. Over 100 people attended and asked insightful questions.",
        summary: "Internal tech talk on semantic search, 100+ attendees",
        importanceScore: 7.5,
        confidenceScore: 1.0,
        emotionalWeight: 3,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Two weeks ago, Carol collaborated with the ML infrastructure team to deploy her embedding model to production. It's now serving 1M requests/day.",
        summary: "Deployed embedding model, 1M requests/day",
        importanceScore: 8.5,
        confidenceScore: 1.0,
        emotionalWeight: 4,
      },
      {
        category: "EPISODIC_EVENTS",
        content:
          "Carol attended a workshop on neural information retrieval last month. She learned about new techniques like dense passage retrieval and ColBERT.",
        summary: "Attended neural IR workshop, learned DPR and ColBERT",
        importanceScore: 7.0,
        confidenceScore: 1.0,
        emotionalWeight: 2.5,
      },

      // CONTEXT_PATTERNS
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Carol often works on multiple experiments in parallel. She keeps detailed notes and always versions her models and datasets.",
        summary: "Parallel experiments, detailed notes, versions everything",
        importanceScore: 6.0,
        confidenceScore: 0.9,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Carol reviews recent papers every Monday morning. She reads 5-10 papers per week to stay current with the latest research.",
        summary: "Monday paper reviews, 5-10 papers per week",
        importanceScore: 6.5,
        confidenceScore: 0.95,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "When starting a new experiment, Carol always creates a hypothesis doc first, defining success metrics and expected outcomes.",
        summary: "Creates hypothesis docs before experiments",
        importanceScore: 6.0,
        confidenceScore: 0.9,
        emotionalWeight: 0.5,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Carol schedules 'deep research' blocks every Wednesday afternoon where she doesn't take any meetings and focuses purely on experimentation.",
        summary: "Wednesday afternoon deep research blocks",
        importanceScore: 5.5,
        confidenceScore: 0.85,
        emotionalWeight: 1,
      },
      {
        category: "CONTEXT_PATTERNS",
        content:
          "Carol maintains a personal blog where she writes about her research findings. She publishes a new post every month.",
        summary: "Maintains research blog, monthly posts",
        importanceScore: 5.0,
        confidenceScore: 0.8,
        emotionalWeight: 1.5,
      },
    ];
  }

  // Use batch creation for efficiency
  console.log(`Creating ${memories.length} memories using batch creation...`);
  const startTime = Date.now();

  const memoryInputs: CreateMemoryInput[] = memories.map((m) => ({
    userId,
    ...m,
  }));

  const createdIds = await createMemories(memoryInputs, { provider: "ollama" });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ Created ${createdIds.length} memories in ${duration}s`);

  // Show summary by category
  const categories = memories.reduce(
    (acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("\nMemories by category:");
  Object.entries(categories).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  return createdIds;
}

// ============
// Search Examples
// ============

async function performSearches(userId: string, userName: string) {
  log(`🔍 Similarity Search Examples for ${userName}`);

  // Use Chinese queries for user A, English for others
  const queries =
    userName === "A"
      ? [
          {
            question: "用户会哪些编程语言和技术？",
            category: undefined,
          },
          {
            question: "用户目前在做什么工作？",
            category: undefined,
          },
          {
            question: "告诉我关于她的教育背景和经历",
            category: "USER_FACTS" as const,
          },
          {
            question: "她的职业目标和抱负是什么？",
            category: "USER_GOALS" as const,
          },
          {
            question: "她最近做了什么？",
            category: "EPISODIC_EVENTS" as const,
          },
        ]
      : [
          {
            question:
              "What programming languages and technologies does the user know?",
            category: undefined,
          },
          {
            question: "What is the user currently working on?",
            category: undefined,
          },
          {
            question: "Tell me about their education and background",
            category: "USER_FACTS" as const,
          },
          {
            question: "What are their career goals and ambitions?",
            category: "USER_GOALS" as const,
          },
          {
            question: "What did they do recently?",
            category: "EPISODIC_EVENTS" as const,
          },
        ];

  for (const query of queries) {
    console.log(`\n🔎 Query: "${query.question}"`);
    if (query.category) {
      console.log(`   Filtering by category: ${query.category}`);
    }

    const results = await searchSimilarMemories({
      userId,
      query: query.question,
      limit: 3,
      minSimilarity: 0.0,
      category: query.category,
      provider: "ollama",
    });

    if (results.length === 0) {
      console.log("   ❌ No similar memories found");
      continue;
    }

    console.log(`   ✅ Found ${results.length} similar memories:\n`);
    results.forEach((result, i) => {
      console.log(`   ${i + 1}. [Similarity: ${result.similarity.toFixed(3)}]`);
      console.log(`      ${result.memory.summary}`);
      console.log(`      Category: ${result.memory.category}`);
      console.log(`      Importance: ${result.memory.importanceScore}/10`);
    });
  }
}

async function showTopMemories(userId: string, userName: string) {
  log(`⭐ Top Memories for ${userName}`);

  const topMemories = await getTopMemories(userId, 10);

  console.log(`\nShowing ${topMemories.length} most important memories:\n`);
  topMemories.forEach((memory, i) => {
    console.log(`${i + 1}. [${memory.category}] ${memory.summary}`);
    console.log(`   Importance: ${memory.importanceScore}/10`);
    console.log(`   Access Count: ${memory.accessCount}`);
  });
}

async function showMemoriesByCategory(userId: string, userName: string) {
  log(`📂 Memories by Category for ${userName}`);

  const categories = [
    "USER_FACTS",
    "USER_PREFERENCES",
    "USER_GOALS",
    "EPISODIC_EVENTS",
    "CONTEXT_PATTERNS",
  ] as const;

  for (const category of categories) {
    const memories = await listMemories({
      userId,
      category,
      status: "active",
      orderBy: "importance",
      orderDir: "desc",
    });

    console.log(`\n📁 ${category} (${memories.length} memories)`);
    if (memories.length > 0) {
      memories.slice(0, 5).forEach((m, i) => {
        console.log(
          `   ${i + 1}. ${m.summary} (importance: ${m.importanceScore})`,
        );
      });
      if (memories.length > 5) {
        console.log(`   ... and ${memories.length - 5} more`);
      }
    }
  }
}

// ============
// Main Script
// ============

async function main() {
  console.log("\n🚀 Memory System Example - Seed & Search (Batch Creation)\n");

  try {
    // Step 0: Clean up existing test data
    await cleanupTestData();

    // Step 1: Seed users
    const users = await seedUsers();
    console.log(`\n✅ Created ${users.length} users`);

    // Step 2: Seed memories for each user (using batch creation)
    for (const user of users) {
      await seedMemories(user.id, user.name!);
    }

    // Wait a moment for embeddings to be generated
    console.log("\n⏳ Waiting for embeddings to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 3: Perform searches for each user
    for (const user of users) {
      await performSearches(user.id, user.name!);
      await showTopMemories(user.id, user.name!);
      await showMemoriesByCategory(user.id, user.name!);
    }

    log("✨ Example Complete!");
    console.log(
      "\n💡 Try running your own queries by calling searchSimilarMemories()",
    );
    console.log("   with different query strings!\n");
  } catch (error) {
    console.error("\n❌ Error:", error);
    throw error;
  }
}

main().catch(console.error);
