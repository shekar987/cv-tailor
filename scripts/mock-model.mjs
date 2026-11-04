// A stand-in for the Anthropic API, so the real /api/tailor pipeline can run with no paid
// call. Start it, then start the app with ANTHROPIC_BASE_URL=http://127.0.0.1:3999.
//
//   node scripts/mock-model.mjs
//
// The pool step writes four long bullets per project, so page-fit paths can be exercised.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3999);
const LONG = "Built and shipped this part of the service in Python with automated tests, and measured the result against the previous release before rolling it out to everyone using it";

function poolNames(system) {
  const at = system.indexOf("PROJECT POOL");
  const end = system.indexOf("You will receive the JD analysis", at);
  const block = at >= 0 ? system.slice(at, end > at ? end : undefined) : "";
  const paragraphs = block.split(/\n\s*\n/).slice(0).map((p) => p.trim()).filter(Boolean);
  const names = [];
  for (const p of paragraphs) {
    for (const line of p.split("\n")) {
      const m = /^([A-Z][^|\n]{1,80}?)(?:\s*\|.*)?$/.exec(line.trim());
      if (m && !/^(?:PROJECT POOL|words\.|technology|entry|Tech:|Personal|University|Live:|GitHub:)/.test(m[1]) && /\|/.test(line)) {
        names.push(m[1].trim());
        break;
      }
    }
  }
  return names;
}

// The experience step answers by id, as the real prompt asks: every role and bullet it was given.
function experienceAnswer(system) {
  const out = [];
  for (const raw of system.split("\n")) {
    const line = raw.trim();
    const role = /^ROLE \d+: (.+)$/.exec(line);
    if (role) out.push(`${out.length ? "\n" : ""}${role[1]}`);
    const bullet = /^\[(R\d+\.\d+)\] (.+)$/.exec(line);
    if (bullet) out.push(`• [${bullet[1]}] ${bullet[2]}`);
  }
  return out.join("\n");
}

function answer(system) {
  if (/^ROLE \d+: /m.test(system) && /^\[R\d+\.\d+\] /m.test(system)) return experienceAnswer(system);
  if (system.includes("You select and tailor CV projects")) {
    const names = poolNames(system);
    return JSON.stringify({ selected: names.map((name, i) => ({ name: i === 0 ? `${name} (reworded by the model)` : name, date: "1999", tech: "Made Up Tech", bullets: [1, 2, 3, 4].map((n) => `${LONG}, step ${n}`) })) });
  }
  if (/JSON/.test(system)) return "{}";
  return "Software engineer with experience building web services and automated tests for real customers.";
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    let system = "";
    try {
      const body = JSON.parse(raw || "{}");
      system = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((s) => s.text ?? "").join("\n") : "";
    } catch {
      // An unreadable body gets the plain answer.
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: "mock",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: answer(system) }],
    }));
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock model on ${PORT}`));
