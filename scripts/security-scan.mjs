// Auditoría local de texto y blobs Git; nunca imprime valores secretos.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const findings = [];
function scan(text, source) {
  const patterns = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["secret-token", /(?:sb_secret_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/],
    ["literal-password", /(?:password|passwd|client_secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i],
  ];
  for (const [kind, pattern] of patterns) if (pattern.test(text)) findings.push({ source, kind, value: "[REDACTED]" });
  for (const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const claims = JSON.parse(Buffer.from(token[0].split(".")[1], "base64url").toString());
      if (claims.role !== "anon") findings.push({ source, kind: "non-public-jwt", value: "[REDACTED]" });
    } catch { findings.push({ source, kind: "unclassified-jwt", value: "[REDACTED]" }); }
  }
}
const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean);
for (const file of files) if (existsSync(file) && !/\.(png|jpg|ico|woff2?)$/i.test(file)) scan(readFileSync(file,"utf8"), file);
let blobs = 0;
for (const entry of git("rev-list","--objects","--all").trim().split("\n")) {
  const space = entry.indexOf(" "); if (space < 0) continue;
  const oid = entry.slice(0,space), path = entry.slice(space+1);
  if (git("cat-file","-t",oid).trim() !== "blob") continue;
  blobs++; scan(git("cat-file","-p",oid), `git:${oid.slice(0,12)}:${path}`);
}
let environment = [];
if (existsSync(".env.local")) {
  const text = readFileSync(".env.local","utf8"); scan(text, ".env.local (ignored)");
  environment = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(([,name,value]) => {
    let classification = name === "NEXT_PUBLIC_SUPABASE_URL" ? "public-url" : name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? "review-public-key" : "server-only";
    if (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
      if (value.startsWith("sb_publishable_")) classification = "publishable";
      try { if (JSON.parse(Buffer.from(value.split(".")[1],"base64url").toString()).role === "anon") classification = "anon-public"; } catch {}
    }
    return { name, classification };
  });
}
console.log(JSON.stringify({ files: files.length, commits: Number(git("rev-list","--count","--all")), blobs, environment, findings,
  limitation: "Solo checkout y refs Git locales. No certifica ramas remotas, forks, logs ni GitHub Secrets." }, null, 2));
if (findings.length) process.exitCode = 1;
