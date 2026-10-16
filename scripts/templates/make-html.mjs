// Generates HTML resume templates in the styles people actually export from (Canva/Novoresume
// sidebars, LaTeX "Jake's resume", grid skills, fixed header/footer). Chrome prints them to PDF
// (see build-templates.ps1), so the PDFs carry real browser text layout, fonts and images.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "fixtures/templates/html";
mkdirSync(OUT, { recursive: true });

export const P = {
  name: "Jordan Rivera",
  title: "Senior Software Engineer",
  email: "jordan.rivera@example.com",
  phone: "(512) 555-0142",
  linkedin: "linkedin.com/in/jordan-rivera-dev",
  github: "github.com/jrivera-dev",
  location: "Austin, TX",
  summary:
    "Full-stack software engineer with 6 years of experience building React and Node.js applications for B2B SaaS products. Owns features end to end, from REST API design to TypeScript front ends and CI/CD pipelines.",
  roles: [
    {
      title: "Software Engineer II",
      company: "Brightline Analytics",
      dates: "Mar 2022 – Present",
      bullets: [
        "Built a React and TypeScript dashboard used by 1,200+ enterprise customers, reducing support tickets by 18%.",
        "Migrated legacy jQuery pages to React, cutting page load time from 4.1s to 1.6s.",
        "Designed REST APIs in Node.js and Express for the reporting platform serving 40M requests per month.",
      ],
    },
    {
      title: "Software Engineer",
      company: "Copperleaf Health",
      dates: "Jun 2019 – Feb 2022",
      bullets: [
        "Developed REST APIs in Node.js and PostgreSQL for a scheduling product serving 40 clinics.",
        "Wrote unit tests with Jest, raising coverage from 52% to 81%.",
        "Implemented role-based access control with OAuth 2.0 and JWT.",
      ],
    },
    {
      title: "Junior Web Developer",
      company: "Pixel & Pine Studio",
      dates: "Jan 2018 – May 2019",
      bullets: ["Built responsive marketing sites with HTML, CSS and JavaScript for 15 clients."],
    },
  ],
  education: "B.S. Computer Science, University of Texas at Austin, 2017",
  skills: ["JavaScript", "TypeScript", "React", "Node.js", "Express", "PostgreSQL", "REST APIs", "Jest", "Git", "GitHub Actions", "AWS", "Docker"],
};

// 1x1 grey PNG used as a "profile photo" (scaled up by CSS).
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const page = (title, css, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; color: #1a1a1a; }
${css}
</style></head><body>${body}</body></html>`;

const roleHtml = (r, cls = "") =>
  `<div class="role ${cls}"><div class="rh"><span class="rt">${r.title}</span><span class="rd">${r.dates}</span></div><div class="rc">${r.company}</div><ul>${r.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>`;

// 1. Canva / Novoresume-style sidebar: photo, icon glyphs, skill bars, two columns.
writeFileSync(
  `${OUT}/modern-sidebar.html`,
  page(
    "modern-sidebar",
    `body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; display: grid; grid-template-columns: 2.6in 1fr; min-height: 11in; }
     aside { background: #1f3b57; color: #fff; padding: 0.5in 0.3in; }
     aside img { width: 1.2in; height: 1.2in; border-radius: 50%; display: block; margin: 0 auto 12px; }
     aside h3 { font-size: 10.5pt; letter-spacing: 1px; border-bottom: 1px solid #fff6; margin: 18px 0 8px; }
     .ic { margin: 4px 0; } .bar { height: 5px; background: #fff3; margin: 2px 0 7px; } .bar i { display: block; height: 5px; background: #8fd3ff; }
     main { padding: 0.5in 0.45in; } h1 { font-size: 24pt; margin: 0; } .sub { color: #1f3b57; font-size: 12pt; margin-bottom: 14px; }
     h2 { font-size: 11.5pt; color: #1f3b57; border-bottom: 2px solid #1f3b57; margin: 16px 0 8px; }
     .rh { display: flex; justify-content: space-between; font-weight: 600; } .rc { font-style: italic; color: #555; } ul { margin: 4px 0 10px 16px; padding: 0; }`,
    `<aside><img src="${PHOTO}" alt="">
      <h3>CONTACT</h3><div class="ic">✉ ${P.email}</div><div class="ic">☎ ${P.phone}</div><div class="ic">⌂ ${P.location}</div><div class="ic">🔗 ${P.linkedin}</div>
      <h3>SKILLS</h3>${P.skills.slice(0, 8).map((s, i) => `<div>${s}</div><div class="bar"><i style="width:${95 - i * 6}%"></i></div>`).join("")}
      <h3>EDUCATION</h3><div>${P.education}</div></aside>
     <main><h1>${P.name}</h1><div class="sub">${P.title}</div><h2>PROFILE</h2><p>${P.summary}</p><h2>EXPERIENCE</h2>${P.roles.map((r) => roleHtml(r)).join("")}</main>`,
  ),
);

// 2. "Jake's resume" LaTeX look: single column, serif, right-aligned dates, small-caps rules.
writeFileSync(
  `${OUT}/latex-classic.html`,
  page(
    "latex-classic",
    `body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; padding: 0.55in 0.6in; }
     h1 { text-align: center; font-size: 22pt; margin: 0; font-variant: small-caps; } .contact { text-align: center; margin: 4px 0 10px; }
     h2 { font-variant: small-caps; font-size: 12pt; border-bottom: 1px solid #000; margin: 14px 0 6px; }
     .rh { display: flex; justify-content: space-between; } .rt { font-weight: bold; } .rc { font-style: italic; } ul { margin: 2px 0 8px 18px; padding: 0; }`,
    `<h1>${P.name}</h1><div class="contact">${P.phone} | ${P.email} | ${P.linkedin} | ${P.github} | ${P.location}</div>
     <h2>Summary</h2><p>${P.summary}</p>
     <h2>Experience</h2>${P.roles.map((r) => roleHtml(r)).join("")}
     <h2>Education</h2><div class="rh"><span class="rt">University of Texas at Austin</span><span>2013 – 2017</span></div><div class="rc">B.S. Computer Science</div>
     <h2>Technical Skills</h2><p><b>Languages & Frameworks:</b> ${P.skills.join(", ")}</p>`,
  ),
);

// 3. Single column with a 3-column skills grid and side-by-side education/certifications.
writeFileSync(
  `${OUT}/skills-grid.html`,
  page(
    "skills-grid",
    `body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; padding: 0.6in 0.7in; }
     h1 { margin: 0; font-size: 22pt; } h2 { font-size: 12pt; text-transform: uppercase; color: #2a5d8a; margin: 14px 0 6px; border-bottom: 1px solid #ccc; }
     .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 20px; } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
     .rh { display: flex; justify-content: space-between; font-weight: bold; } ul { margin: 2px 0 8px 18px; padding: 0; }`,
    `<h1>${P.name}</h1><div>${P.location} · ${P.email} · ${P.phone} · ${P.linkedin}</div>
     <h2>Professional Summary</h2><p>${P.summary}</p>
     <h2>Skills</h2><div class="grid">${P.skills.map((s) => `<div>• ${s}</div>`).join("")}</div>
     <h2>Work Experience</h2>${P.roles.map((r) => roleHtml(r)).join("")}
     <div class="two"><div><h2>Education</h2><p>${P.education}</p></div><div><h2>Certifications</h2><p>AWS Certified Cloud Practitioner, 2023</p></div></div>`,
  ),
);

// 4. Contact details in a fixed print header band (what "Insert > Header" produces).
writeFileSync(
  `${OUT}/header-contact.html`,
  page(
    "header-contact",
    `body { font-family: Arial, sans-serif; font-size: 10.5pt; padding: 0.75in 0.7in 0.6in; }
     .hdr { position: fixed; top: 0.18in; left: 0.7in; right: 0.7in; font-size: 8.5pt; color: #444; display: flex; justify-content: space-between; }
     h1 { margin: 0; font-size: 20pt; } h2 { font-size: 11.5pt; text-transform: uppercase; margin: 14px 0 6px; border-bottom: 1px solid #999; }
     .rh { display: flex; justify-content: space-between; font-weight: bold; } ul { margin: 2px 0 8px 18px; padding: 0; }`,
    `<div class="hdr"><span>${P.email} | ${P.phone}</span><span>${P.linkedin}</span></div>
     <h1>${P.name}</h1><div>${P.title} · ${P.location}</div>
     <h2>Summary</h2><p>${P.summary}</p><h2>Experience</h2>${P.roles.map((r) => roleHtml(r)).join("")}
     <h2>Education</h2><p>${P.education}</p><h2>Skills</h2><p>${P.skills.join(", ")}</p>`,
  ),
);

// 5. Two pages with a running footer ("Name · email · Page n").
// Pad to two pages with longer bullet lists (dates stay in reverse-chronological order).
const many = P.roles.map((r) => ({ ...r, bullets: [...r.bullets, ...r.bullets.map((b) => b.replace(/\.$/, ", partnering with product and design on scope and rollout."))] }));
writeFileSync(
  `${OUT}/two-page-footer.html`,
  page(
    "two-page-footer",
    `body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; padding: 0.6in 0.75in 0.8in; }
     .ftr { position: fixed; bottom: 0.2in; left: 0.75in; right: 0.75in; font-size: 8.5pt; color: #555; text-align: center; }
     h1 { margin: 0; } h2 { font-size: 13pt; text-transform: uppercase; margin: 16px 0 6px; border-bottom: 1px solid #999; }
     .rh { display: flex; justify-content: space-between; font-weight: bold; } ul { margin: 2px 0 10px 18px; padding: 0; } li { margin: 3px 0; }`,
    `<div class="ftr">${P.name} · ${P.email} · ${P.phone}</div>
     <h1>${P.name}</h1><div>${P.location} · ${P.linkedin}</div>
     <h2>Summary</h2><p>${P.summary}</p><h2>Experience</h2>${many.map((r) => roleHtml(r)).join("")}
     <h2>Education</h2><p>${P.education}</p><h2>Skills</h2><p>${P.skills.join(", ")}</p>`,
  ),
);

writeFileSync("fixtures/templates/person.json", JSON.stringify(P, null, 2));
console.log("html templates written");
