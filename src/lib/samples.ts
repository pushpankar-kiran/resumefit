// Fictional sample data for quick testing. Names, companies and contact details are invented.

export interface Sample {
  id: string;
  label: string;
  resumeName: string;
  resume: string;
  jd: string;
}

const DEV_RESUME = `Jordan Rivera
Austin, TX | jordan.rivera@example.com | (512) 555-0142 | linkedin.com/in/jordan-rivera-dev

PROFESSIONAL SUMMARY
Full-stack software engineer with 6 years of experience building React and Node.js applications for B2B SaaS products. Comfortable owning features end to end, from REST API design to TypeScript front ends and CI/CD pipelines.

WORK EXPERIENCE
Software Engineer II | Brightline Analytics | Mar 2022 – Present
• Worked on backend APIs using Node.js and Express for the reporting platform.
• Built a React and TypeScript dashboard used by 1,200+ enterprise customers, reducing support tickets by 18%.
• Responsible for code reviews and mentoring two junior engineers.
• Migrated legacy jQuery pages to React, cutting page load time from 4.1s to 1.6s.
• Helped improve the CI/CD pipeline in GitHub Actions.

Software Engineer | Copperleaf Health | Jun 2019 – Feb 2022
• Developed REST APIs in Node.js and PostgreSQL for a patient scheduling product serving 40 clinics.
• Participated in sprint planning and daily standups in an Agile team.
• Wrote unit tests with Jest, raising coverage from 52% to 81%.
• Implemented role-based access control with OAuth 2.0 and JWT.

Junior Web Developer | Pixel & Pine Studio | Jan 2018 – May 2019
• Built responsive marketing sites with HTML, CSS and JavaScript.
• Assisted with WordPress maintenance for 15 small-business clients.

EDUCATION
B.S. Computer Science, University of Texas at Austin, 2017

SKILLS
JavaScript, TypeScript, React, Node.js, Express, PostgreSQL, REST APIs, Jest, Git, GitHub Actions, AWS (S3, EC2), Agile`;

const DEV_JD = `Senior Full-Stack Engineer

About the role
We're looking for a Senior Full-Stack Engineer to help scale our developer platform. You'll own services end to end and partner with product and design.

What you'll do
- Design and build scalable microservices in Node.js and TypeScript
- Build performant React front ends with GraphQL data layers
- Containerize services with Docker and deploy them to Kubernetes on AWS
- Improve CI/CD pipelines and observability
- Mentor engineers and lead code reviews

Requirements
- 5+ years of professional software engineering experience
- Strong proficiency in TypeScript, React and Node.js
- Experience designing REST APIs and GraphQL schemas
- Hands-on experience with Docker and Kubernetes
- Experience with PostgreSQL or another relational database
- Solid understanding of CI/CD and automated testing

Nice to have
- AWS Lambda and serverless architectures
- Terraform or other Infrastructure as Code tools
- Experience with Redis and Kafka
- AWS Certified Solutions Architect

About us
We're a remote-first company building tools developers love. We offer competitive salary, equity and unlimited PTO.`;

const PM_RESUME = `Priya Shah
priya.shah@example.com • +1 (415) 555-0199 • San Francisco, CA

About Me
Product manager with 7 years of experience shipping B2B SaaS products. I love turning customer problems into roadmaps that move metrics.

Where I've Been
Senior Product Manager — Northwind Software                  01/2021 - Present
• Owned the roadmap for the billing and payments product line, growing net revenue retention from 104% to 117%.
• Led discovery with 40+ customer interviews to define a self-serve onboarding flow that lifted activation by 22%.
• Responsible for writing PRDs and user stories for the engineering team.
• Partnered with design and engineering to ship usage-based pricing in two quarters.

Product Manager — Lumen Retail Tech               Summer 2018 – Dec 2020
• Managed the mobile checkout experience for 2M monthly users.
• Worked on A/B tests to improve conversion.
• Helped the sales team with enterprise demos.

Associate Product Manager — Quill Labs                    Jun 2016 – Jul 2018
• Supported the PM team on backlog grooming and sprint planning.
• Analyzed funnel data in SQL and Excel to find drop-off points.

Education
MBA, Haas School of Business, UC Berkeley
B.A. Economics, UCLA

What I Know
Roadmapping, Jira, Figma, SQL, A/B Testing, Stakeholder Management, Agile`;

const PM_JD = `Job Title: Senior Product Manager, Growth

We are seeking a Senior Product Manager to lead our Growth team and drive acquisition, activation and monetization for our B2B SaaS platform.

Responsibilities:
- Own the growth product roadmap and define success metrics (OKRs/KPIs)
- Run a high-velocity experimentation program (A/B testing) across the funnel
- Conduct user research and customer interviews to uncover friction
- Write clear PRDs and partner with engineering, design and marketing
- Use data analysis in SQL and product analytics tools like Amplitude or Mixpanel to prioritize work
- Communicate strategy to executive stakeholders

Qualifications:
- 6+ years of product management experience, including 2+ in growth or monetization
- Proven track record with experimentation and A/B testing
- Strong SQL skills and comfort with product analytics (Amplitude, Mixpanel, Looker)
- Experience with pricing and packaging
- Excellent stakeholder management and communication skills
- Experience working in Agile/Scrum teams

Preferred:
- Experience with PLG (product-led growth) motions
- Familiarity with Salesforce and HubSpot
- Certified Scrum Product Owner (CSPO)

Benefits: health, dental, 401(k), flexible PTO.`;

export const SAMPLES: Sample[] = [
  { id: "dev", label: "Software Engineer", resumeName: "jordan-rivera-resume.txt", resume: DEV_RESUME, jd: DEV_JD },
  { id: "pm", label: "Product Manager", resumeName: "priya-shah-resume.txt", resume: PM_RESUME, jd: PM_JD },
];
