// Edge aislado. CSP se prueba alterando HTML recibido, no evaluando JS privilegiado.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel:"msedge", headless:true });
try {
  const page = await browser.newPage({ bypassCSP:false });
  const errors=[]; const cspErrors=[];
  page.on("pageerror", error=>errors.push(error.message));
  page.on("console", message=>{if(message.text().includes("Content Security Policy"))cspErrors.push(message.text());});
  await page.route("**/*", async route => {
    const url=new URL(route.request().url());
    if(url.hostname!=="127.0.0.1") {
      if(url.pathname==="/auth/v1/token")return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error_code:"invalid_credentials",msg:"Invalid login credentials"})});
      return route.abort();
    }
    if(url.pathname==="/login" && route.request().resourceType()==="document") {
      const response=await route.fetch();
      return route.fulfill({response,body:(await response.text()).replace("</head>",'<script>window.cspAttackSucceeded=true</script></head>')});
    }
    return route.continue();
  });
  const response=await page.goto("http://127.0.0.1:3107/login");
  assert.ok(response.headers()["content-security-policy"]);
  await page.getByLabel("Correo electrónico").fill("qa@example.test");
  await page.getByLabel("Contraseña").fill("qa-dummy-only");
  await page.getByRole("button",{name:"Iniciar sesión",exact:true}).click();
  await page.getByText("Correo o contraseña incorrectos.",{exact:true}).waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>Boolean(window.cspAttackSucceeded)),false);
  assert.ok(cspErrors.length>0);
  console.log("PASS: production login renders/hydrates; injected non-nonce HTML script blocked; all remote requests blocked.");
} finally { await browser.close(); }
