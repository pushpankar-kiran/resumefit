// Generates PDF test fixtures: a clean single-column resume and a risky two-column one.
import { jsPDF } from "jspdf";
import { writeFileSync } from "node:fs";
import { SAMPLES_TEXT } from "../fixtures/sample-text.mjs";

function single() {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = 60;
  for (const line of SAMPLES_TEXT.split("\n")) {
    const wrapped = doc.splitTextToSize(line || " ", 500);
    for (const w of wrapped) {
      if (y > 740) { doc.addPage(); y = 60; }
      doc.setFontSize(10).text(w, 56, y);
      y += 13;
    }
  }
  return Buffer.from(doc.output("arraybuffer"));
}

function twoColumn() {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  // Contact details inside the header band (top ~30pt of the page)
  doc.setFontSize(8).text("jordan.rivera@example.com  |  (512) 555-0142", 56, 22);
  doc.setFontSize(16).text("Jordan Rivera", 56, 70);
  const left = ["SKILLS", "JavaScript", "TypeScript", "React", "Node.js", "PostgreSQL", "Jest", "Git", "", "EDUCATION", "B.S. Computer Science", "UT Austin, 2017", "", "LANGUAGES", "English", "Spanish", "", "INTERESTS", "Cycling", "Chess"];
  const right = ["WORK EXPERIENCE", "Software Engineer II | Brightline Analytics | Mar 2022 - Present",
    "- Built a React and TypeScript dashboard used by 1,200+ customers.",
    "- Migrated legacy jQuery pages to React, cutting load time by 60%.",
    "- Responsible for code reviews and mentoring two junior engineers.",
    "", "Software Engineer | Copperleaf Health | Jun 2019 - Feb 2022",
    "- Developed REST APIs in Node.js and PostgreSQL for 40 clinics.",
    "- Wrote unit tests with Jest, raising coverage from 52% to 81%.",
    "- Implemented role-based access control with OAuth 2.0.",
    "", "Junior Web Developer | Pixel & Pine | Jan 2018 - May 2019",
    "- Built responsive marketing sites with HTML, CSS and JavaScript.",
    "- Assisted with WordPress maintenance for 15 clients.",
    "", "PROFESSIONAL SUMMARY", "Full-stack engineer, 6 years building", "React and Node.js products for B2B SaaS."];
  let y = 110;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    doc.setFontSize(9.5);
    if (left[i]) doc.text(left[i], 56, y);
    if (right[i]) doc.text(doc.splitTextToSize(right[i], 330)[0], 230, y);
    y += 14;
  }
  return Buffer.from(doc.output("arraybuffer"));
}

writeFileSync("fixtures/resume-single-column.pdf", single());
writeFileSync("fixtures/resume-two-column.pdf", twoColumn());
console.log("pdf fixtures written");

// Image-only "scanned" PDF (no text layer)
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const scan = new jsPDF({ unit: "pt", format: "letter" });
scan.addImage("data:image/png;base64," + PX, "PNG", 40, 40, 530, 700);
writeFileSync("fixtures/resume-scanned.pdf", Buffer.from(scan.output("arraybuffer")));
console.log("scanned fixture written");

// Hidden-keyword trick: white text stuffed at the bottom of an otherwise normal resume.
const hid = new jsPDF({ unit: "pt", format: "letter" });
let hy = 60;
for (const line of SAMPLES_TEXT.split("\n")) {
  for (const w of hid.splitTextToSize(line || " ", 500)) { hid.setFontSize(10).text(w, 56, hy); hy += 13; }
}
hid.setTextColor(255, 255, 255).setFontSize(6).text("Docker Kubernetes GraphQL Terraform Kafka Redis Docker Kubernetes GraphQL Terraform", 56, 700);
writeFileSync("fixtures/resume-hidden-text.pdf", Buffer.from(hid.output("arraybuffer")));
console.log("hidden-text fixture written");
