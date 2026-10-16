import type { KeywordCategory } from "../types";

// Curated taxonomy. Each entry: canonical term, aliases (acronyms, spellings, versions),
// category, and a "family" used to award partial credit for related-but-different skills
// (e.g. PostgreSQL on the resume when the JD asks for MySQL).

export interface SkillDef {
  term: string;
  aliases: string[];
  category: KeywordCategory;
  family?: string;
}

const H = "hard_skill" as const;
const T = "tool" as const;
const C = "certification" as const;
const S = "soft_skill" as const;

const RAW: [string, string[], KeywordCategory, string?][] = [
  // Languages
  ["JavaScript", ["js", "ecmascript", "es6", "es2015"], H, "lang-js"],
  ["TypeScript", ["ts"], H, "lang-js"],
  ["Python", ["py", "python3"], H, "lang-py"],
  ["Java", ["java 8", "java 11", "java 17", "j2ee", "jee"], H, "lang-jvm"],
  ["Kotlin", [], H, "lang-jvm"],
  ["Scala", [], H, "lang-jvm"],
  ["Go", ["golang"], H, "lang-sys"],
  ["Rust", [], H, "lang-sys"],
  ["C++", ["cpp", "c plus plus"], H, "lang-sys"],
  ["C#", ["c sharp", "csharp"], H, "lang-dotnet"],
  ["C", [], H, "lang-sys"],
  ["Ruby", [], H, "lang-ruby"],
  ["PHP", [], H, "lang-php"],
  ["Swift", [], H, "mobile"],
  ["Objective-C", ["objc"], H, "mobile"],
  ["R", ["r programming", "rstudio"], H, "lang-data"],
  ["SQL", ["structured query language", "t-sql", "tsql", "pl/sql", "plsql", "ansi sql"], H, "sql"],
  ["Bash", ["shell scripting", "shell", "unix shell", "zsh"], H, "shell"],
  ["PowerShell", [], H, "shell"],
  ["HTML", ["html5"], H, "web"],
  ["CSS", ["css3", "scss", "sass", "less"], H, "web"],
  ["Dart", [], H, "mobile"],
  ["MATLAB", [], H, "lang-data"],
  ["Solidity", [], H, "web3"],
  // Frontend
  ["React", ["react.js", "reactjs", "react js"], T, "fe-framework"],
  ["Next.js", ["nextjs", "next js"], T, "fe-framework"],
  ["Vue.js", ["vue", "vuejs", "nuxt", "nuxt.js"], T, "fe-framework"],
  ["Angular", ["angularjs", "angular.js"], T, "fe-framework"],
  ["Svelte", ["sveltekit"], T, "fe-framework"],
  ["Redux", ["redux toolkit", "rtk"], T, "fe-state"],
  ["Tailwind CSS", ["tailwind", "tailwindcss"], T, "web"],
  ["Webpack", ["vite", "rollup", "esbuild"], T, "build"],
  ["React Native", [], T, "mobile"],
  ["Flutter", [], T, "mobile"],
  ["jQuery", [], T, "web"],
  ["Accessibility", ["a11y", "wcag", "aria"], H, "web"],
  ["Responsive Design", ["mobile-first design"], H, "web"],
  // Backend
  ["Node.js", ["node", "nodejs", "node js"], T, "be-js"],
  ["Express", ["express.js", "expressjs"], T, "be-js"],
  ["NestJS", ["nest.js"], T, "be-js"],
  ["Django", [], T, "be-py"],
  ["Flask", [], T, "be-py"],
  ["FastAPI", ["fast api"], T, "be-py"],
  ["Spring Boot", ["spring", "spring framework", "spring mvc"], T, "be-jvm"],
  ["Ruby on Rails", ["rails", "ror"], T, "be-ruby"],
  [".NET", ["dotnet", "asp.net", ".net core", "asp.net core"], T, "lang-dotnet"],
  ["Laravel", [], T, "lang-php"],
  ["REST APIs", ["rest", "restful", "restful apis", "rest api", "restful services", "restful api"], H, "api"],
  ["GraphQL", ["apollo", "graph ql"], H, "api"],
  ["gRPC", ["protocol buffers", "protobuf"], H, "api"],
  ["Microservices", ["microservice", "microservices architecture", "service-oriented architecture", "soa"], H, "arch"],
  ["Event-Driven Architecture", ["event driven", "event-driven", "pub/sub", "pubsub"], H, "arch"],
  ["System Design", ["distributed systems", "scalable systems", "high availability"], H, "arch"],
  ["WebSockets", ["websocket", "socket.io"], H, "api"],
  ["OAuth", ["oauth2", "oauth 2.0", "openid connect", "oidc", "jwt", "sso", "saml"], H, "security"],
  // Data stores
  ["PostgreSQL", ["postgres", "psql"], T, "rdbms"],
  ["MySQL", ["mariadb"], T, "rdbms"],
  ["Microsoft SQL Server", ["sql server", "mssql"], T, "rdbms"],
  ["Oracle Database", ["oracle db", "oracle"], T, "rdbms"],
  ["MongoDB", ["mongo", "mongoose"], T, "nosql"],
  ["Redis", ["elasticache"], T, "cache"],
  ["Cassandra", ["apache cassandra"], T, "nosql"],
  ["DynamoDB", ["dynamo db", "aws dynamodb"], T, "nosql"],
  ["Elasticsearch", ["elastic search", "opensearch", "elk", "elk stack"], T, "search"],
  ["Kafka", ["apache kafka", "kafka streams"], T, "streaming"],
  ["RabbitMQ", ["amqp", "sqs", "message queues", "message queue"], T, "streaming"],
  ["Snowflake", [], T, "warehouse"],
  ["BigQuery", ["google bigquery", "big query"], T, "warehouse"],
  ["Redshift", ["amazon redshift", "aws redshift"], T, "warehouse"],
  ["Databricks", [], T, "spark"],
  ["Apache Spark", ["spark", "pyspark", "spark sql"], T, "spark"],
  ["Hadoop", ["hdfs", "hive", "mapreduce"], T, "spark"],
  ["Airflow", ["apache airflow"], T, "orchestration"],
  ["dbt", ["data build tool"], T, "warehouse"],
  ["ETL", ["elt", "etl pipelines", "data pipelines", "data pipeline"], H, "data-eng"],
  ["Data Modeling", ["dimensional modeling", "star schema", "data modelling"], H, "data-eng"],
  // Cloud & DevOps
  ["AWS", ["amazon web services"], T, "cloud"],
  ["Google Cloud Platform", ["gcp", "google cloud"], T, "cloud"],
  ["Microsoft Azure", ["azure"], T, "cloud"],
  ["AWS Lambda", ["lambda", "lambda functions"], T, "serverless"],
  ["Serverless", ["serverless framework", "cloud functions", "azure functions"], H, "serverless"],
  ["Amazon S3", ["s3"], T, "cloud"],
  ["Amazon EC2", ["ec2"], T, "cloud"],
  ["Docker", ["containerization", "containers", "docker compose", "dockerfile"], T, "containers"],
  ["Kubernetes", ["k8s", "eks", "gke", "aks", "helm", "openshift"], T, "containers"],
  ["Terraform", ["hcl", "terraform cloud"], T, "iac"],
  ["Infrastructure as Code", ["iac", "cloudformation", "pulumi", "cdk", "aws cdk"], H, "iac"],
  ["Ansible", ["chef", "puppet"], T, "iac"],
  ["CI/CD", ["ci cd", "continuous integration", "continuous delivery", "continuous deployment", "ci/cd pipelines"], H, "cicd"],
  ["Jenkins", [], T, "cicd"],
  ["GitHub Actions", ["gh actions"], T, "cicd"],
  ["GitLab CI", ["gitlab ci/cd", "gitlab"], T, "cicd"],
  ["CircleCI", [], T, "cicd"],
  ["Git", ["github", "version control", "bitbucket"], T, "vcs"],
  ["Linux", ["unix", "ubuntu", "centos", "rhel"], H, "os"],
  ["Observability", ["monitoring", "logging", "tracing", "opentelemetry"], H, "obs"],
  ["Prometheus", ["grafana"], T, "obs"],
  ["Datadog", ["new relic", "splunk", "sentry"], T, "obs"],
  ["Site Reliability Engineering", ["sre", "slos", "slo", "sla", "incident response", "on-call"], H, "obs"],
  ["Nginx", ["apache http server", "load balancing", "load balancer"], T, "infra"],
  ["Networking", ["tcp/ip", "dns", "http", "vpc"], H, "infra"],
  // Testing & quality
  ["Unit Testing", ["unit tests", "tdd", "test-driven development", "test driven development"], H, "testing"],
  ["Jest", ["vitest", "mocha", "chai"], T, "testing"],
  ["Cypress", ["playwright", "selenium", "puppeteer", "end-to-end testing", "e2e testing"], T, "testing"],
  ["PyTest", ["pytest", "unittest"], T, "testing"],
  ["Code Review", ["code reviews", "peer review"], H, "practice"],
  ["Performance Optimization", ["performance tuning", "web performance", "core web vitals", "latency optimization"], H, "practice"],
  ["Security", ["application security", "appsec", "owasp", "secure coding", "cybersecurity"], H, "security"],
  // Data science & AI
  ["Machine Learning", ["ml", "machine-learning"], H, "ml"],
  ["Deep Learning", ["neural networks"], H, "ml"],
  ["Natural Language Processing", ["nlp"], H, "ml"],
  ["Computer Vision", ["image recognition"], H, "ml"],
  ["Large Language Models", ["llm", "llms", "generative ai", "genai", "gen ai", "prompt engineering", "rag", "retrieval augmented generation"], H, "ml"],
  ["TensorFlow", ["keras"], T, "ml-fw"],
  ["PyTorch", ["torch"], T, "ml-fw"],
  ["scikit-learn", ["sklearn", "scikit learn"], T, "ml-fw"],
  ["Pandas", ["numpy", "dataframes"], T, "py-data"],
  ["MLOps", ["mlflow", "kubeflow", "sagemaker", "model deployment"], H, "ml"],
  ["Statistics", ["statistical analysis", "statistical modeling", "hypothesis testing", "regression"], H, "analytics"],
  ["A/B Testing", ["ab testing", "a/b tests", "experimentation", "split testing", "multivariate testing"], H, "analytics"],
  ["Data Analysis", ["data analytics", "analytics", "data-driven"], H, "analytics"],
  ["Data Visualization", ["dashboards", "dashboarding", "data viz"], H, "bi"],
  ["Tableau", [], T, "bi"],
  ["Power BI", ["powerbi", "power-bi"], T, "bi"],
  ["Looker", ["looker studio", "google data studio"], T, "bi"],
  ["Excel", ["microsoft excel", "advanced excel", "vlookup", "pivot tables", "spreadsheets"], T, "office"],
  ["Google Analytics", ["ga4", "google analytics 4"], T, "product-analytics"],
  ["Mixpanel", ["amplitude", "heap", "pendo"], T, "product-analytics"],
  ["SQL Analytics", ["sql queries", "writing sql"], H, "sql"],
  // Product & business
  ["Product Management", ["product manager", "product ownership", "product owner"], H, "pm"],
  ["Product Roadmap", ["roadmapping", "roadmap", "product roadmaps"], H, "pm"],
  ["Product Strategy", ["product vision", "go-to-market strategy"], H, "pm"],
  ["Go-to-Market", ["gtm", "go to market", "product launch", "product launches"], H, "pm"],
  ["User Research", ["customer research", "user interviews", "customer discovery", "usability testing", "ux research", "customer interviews", "discovery interviews"], H, "research"],
  ["Requirements Gathering", ["prds", "prd", "product requirements", "user stories", "requirements analysis", "business requirements"], H, "pm"],
  ["Agile", ["agile methodologies", "agile methodology", "agile development"], H, "agile"],
  ["Scrum", ["sprint planning", "scrum master", "sprints"], H, "agile"],
  ["Kanban", [], H, "agile"],
  ["Jira", ["atlassian jira", "confluence"], T, "pm-tools"],
  ["Asana", ["trello", "monday.com", "linear"], T, "pm-tools"],
  ["Figma", ["sketch", "adobe xd", "invision"], T, "design-tools"],
  ["Wireframing", ["prototyping", "mockups", "wireframes"], H, "design"],
  ["UX Design", ["user experience", "ui/ux", "ux", "interaction design"], H, "design"],
  ["OKRs", ["okr", "kpis", "kpi", "north star metric", "success metrics"], H, "metrics"],
  ["Prioritization", ["rice", "moscow", "backlog prioritization", "backlog management", "backlog grooming"], H, "pm"],
  ["Market Research", ["competitive analysis", "market analysis", "competitive landscape"], H, "research"],
  ["Product-Led Growth", ["plg", "product led growth", "self-serve growth"], H, "pm"],
  ["Growth Strategy", ["growth experiments", "growth loops", "acquisition and activation"], H, "pm"],
  ["Pricing Strategy", ["pricing", "monetization"], H, "biz"],
  ["SaaS", ["b2b saas", "software as a service"], H, "biz"],
  ["B2B", ["enterprise software", "enterprise customers"], H, "biz"],
  ["Financial Modeling", ["financial models", "dcf", "valuation"], H, "finance"],
  ["Budgeting", ["forecasting", "p&l", "p&l management", "budget management"], H, "finance"],
  ["Salesforce", ["sfdc", "salesforce crm", "crm"], T, "crm"],
  ["HubSpot", [], T, "crm"],
  ["SEO", ["search engine optimization", "sem"], H, "marketing"],
  ["Digital Marketing", ["performance marketing", "paid media", "growth marketing"], H, "marketing"],
  ["Project Management", ["program management", "project planning", "delivery management"], H, "pjm"],
  ["Risk Management", ["risk assessment", "risk mitigation"], H, "pjm"],
  ["Change Management", ["organizational change management", "organisational change management"], H, "pjm"],
  ["Design Thinking", [], H, "research"],
  ["Big Data", [], H, "data-eng"],
  ["Cloud Computing", [], H, "cloud"],
  ["Process Improvement", ["process optimization", "lean", "six sigma", "continuous improvement"], H, "ops"],
  ["Vendor Management", ["supplier management", "third-party management"], H, "ops"],
  ["API Design", ["api development", "openapi", "swagger"], H, "api"],
  ["Technical Writing", ["documentation", "technical documentation"], H, "comm"],
  ["Mobile Development", ["ios", "android", "mobile apps"], H, "mobile"],
  ["Blockchain", ["web3", "smart contracts", "ethereum"], H, "web3"],
  // Certifications
  ["AWS Certified Solutions Architect", ["aws solutions architect", "aws certified", "aws saa", "aws certification"], C, "cert-cloud"],
  ["Google Cloud Professional Cloud Architect", ["gcp certified", "google cloud certified", "professional cloud architect"], C, "cert-cloud"],
  ["Azure Solutions Architect Expert", ["azure certified", "az-305", "az-900", "azure fundamentals"], C, "cert-cloud"],
  ["Certified Kubernetes Administrator", ["cka", "ckad"], C, "cert-k8s"],
  ["PMP", ["project management professional", "pmp certified", "pmp certification"], C, "cert-pm"],
  ["Certified ScrumMaster", ["csm", "psm", "professional scrum master"], C, "cert-agile"],
  ["Certified Scrum Product Owner", ["cspo", "pspo"], C, "cert-agile"],
  ["CISSP", [], C, "cert-sec"],
  ["CompTIA Security+", ["security+", "comptia security plus"], C, "cert-sec"],
  ["CPA", ["certified public accountant"], C, "cert-fin"],
  ["CFA", ["chartered financial analyst"], C, "cert-fin"],
  ["Six Sigma Certification", ["six sigma green belt", "six sigma black belt", "lean six sigma"], C, "cert-ops"],
  ["ITIL", ["itil v4", "itil foundation"], C, "cert-ops"],
  // Soft skills
  ["Leadership", ["led teams", "team leadership", "people leadership", "people management"], S, "lead"],
  ["Mentorship", ["mentoring", "mentored", "mentor", "coaching"], S, "lead"],
  ["Communication", ["communication skills", "written communication", "verbal communication"], S, "comm"],
  ["Stakeholder Management", ["stakeholder communication", "stakeholder engagement", "executive communication", "managing stakeholders"], S, "comm"],
  ["Cross-functional Collaboration", ["cross-functional", "cross functional", "collaboration", "cross-functional teams"], S, "collab"],
  ["Problem Solving", ["problem-solving", "analytical thinking", "critical thinking", "troubleshooting"], S, "think"],
  ["Ownership", ["accountability", "bias for action", "self-starter", "self-motivated"], S, "drive"],
  ["Adaptability", ["flexibility", "fast-paced environment", "ambiguity"], S, "drive"],
  ["Attention to Detail", ["detail-oriented", "detail oriented"], S, "think"],
  ["Time Management", ["prioritize", "multitasking", "deadline-driven"], S, "drive"],
  ["Customer Focus", ["customer obsession", "customer-centric", "user-centric", "customer empathy"], S, "cust"],
  ["Decision Making", ["data-informed decisions", "judgment"], S, "think"],
  ["Negotiation", ["influencing", "influence without authority"], S, "comm"],
  ["Presentation Skills", ["public speaking", "presentations", "storytelling"], S, "comm"],
  ["Strategic Thinking", ["strategic planning", "strategy"], S, "think"],
];

export const SKILLS: SkillDef[] = RAW.map(([term, aliases, category, family]) => ({ term, aliases, category, family }));

const byTerm = new Map(SKILLS.map((s) => [s.term.toLowerCase(), s]));
export function findSkill(term: string): SkillDef | undefined {
  const k = term.toLowerCase();
  return byTerm.get(k) ?? SKILLS.find((s) => s.aliases.includes(k));
}

/**
 * Aliases that are also everyday English words (or a single letter). In free text these only
 * count when written with a capital letter ("Go", "Spark", "REST"), never "go", "spark", "rest".
 */
export const CASE_SENSITIVE = new Set([
  "c", "r", "go", "ts", "js", "ml", "rest", "node", "spark", "lambda", "shell", "spring", "oracle", "ux",
  "rice", "lean", "sem", "linear", "heap", "sketch", "chef", "puppet", "rails", "vue", "react", "angular",
  "express", "torch", "flask", "swift", "dart", "excel", "looker", "hive", "rust", "ruby", "jest",
  "mocha", "chai", "ios", "elk", "sre",
]);

/** Single-letter languages additionally need list context ("Python, R, SQL") to count. */
export const NEEDS_LIST_CONTEXT = new Set(["c", "r", "go"]);

// Most taxonomy aliases are true synonyms (GCP = Google Cloud Platform). The ones listed here
// are siblings in the same tool family (Vite under Webpack): they earn partial "related" credit
// in matching, and when a JD names one we report it under its own name.
const SIBLINGS = new Set([
  "vite", "rollup", "esbuild", "grafana", "new relic", "splunk", "sentry", "playwright", "selenium", "puppeteer",
  "mocha", "chai", "vitest", "trello", "monday.com", "linear", "sketch", "adobe xd", "invision", "amplitude", "heap",
  "pendo", "hive", "mapreduce", "numpy", "keras", "sqs", "amqp", "confluence", "helm", "openshift", "chef", "puppet",
  "cloudformation", "pulumi", "cdk", "aws cdk", "github", "bitbucket", "gitlab", "mariadb", "nuxt", "nuxt.js", "scss",
  "sass", "less", "unittest", "apollo", "protobuf", "protocol buffers", "socket.io", "jwt", "sso", "saml", "elasticache",
  "opensearch", "mongoose", "kafka streams", "mlflow", "kubeflow", "sagemaker", "looker studio", "google data studio",
  "vlookup", "pivot tables", "containers", "containerization", "tracing", "logging", "monitoring", "opentelemetry",
  "tcp/ip", "dns", "http", "vpc", "ubuntu", "centos", "rhel", "ios", "android", "forecasting", "p&l", "crm",
  "sem", "lean", "six sigma", "cassandra", "dynamo db", "spark sql", "pyspark", "load balancing", "load balancer",
  "apache http server", "slo", "slos", "sla", "on-call", "incident response", "mentored", "coaching", "rice", "moscow",
  "competitive analysis", "dcf", "valuation", "pricing", "monetization", "interaction design", "mockups", "prototyping",
  "wireframes", "usability testing", "user stories", "confluence", "sprint planning", "scrum master", "eks", "gke", "aks",
  "azure functions", "cloud functions", "serverless framework", "flexibility", "ambiguity", "public speaking",
  "storytelling", "influencing", "dashboards", "spreadsheets", "rag", "prompt engineering", "dimensional modeling",
  "star schema", "ux research", "customer discovery", "user interviews", "regression", "hypothesis testing",
]);

export function isSynonym(alias: string, _term?: string): boolean {
  return !SIBLINGS.has(alias.toLowerCase());
}

export function synonymsOf(def: SkillDef): string[] {
  return def.aliases.filter((a) => isSynonym(a));
}

export function siblingsOf(def: SkillDef): string[] {
  return def.aliases.filter((a) => !isSynonym(a));
}

/** Canonical display term: synonyms collapse to the taxonomy term, siblings keep their own name. */
export function canonicalOf(term: string): { term: string; def?: SkillDef } {
  const def = findSkill(term);
  if (!def) return { term };
  if (def.term.toLowerCase() === term.toLowerCase() || isSynonym(term)) return { term: def.term, def };
  return { term: titleCase(term), def };
}

function titleCase(s: string): string {
  return s.length <= 4 ? s.toUpperCase() : s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
