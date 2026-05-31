import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middlewares/auth";
import { buildContext } from "../lib/context";

const router: IRouter = Router();

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env["GROQ"]! });
  return _groq;
}

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  keyGenerator: (req) => String((req as typeof req & { user?: { id: number } }).user?.id ?? req.ip),
  message: { error: "Too many requests. Please wait before sending another message." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/ai/chat", requireAuth, chatLimiter, async (req, res): Promise<void> => {
  const groqKey = process.env["GROQ"];
  if (!groqKey) {
    res.status(500).json({ error: "AI service not configured" });
    return;
  }

  const { message, history } = req.body;
  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > 4000) {
    res.status(400).json({ error: "Message is too long. Please keep messages under 4000 characters." });
    return;
  }

  const MAX_HISTORY = 20;
  const trimmedHistory: { role: "user" | "assistant"; content: string }[] = Array.isArray(history)
    ? (history as unknown[])
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            typeof m === "object" &&
            m !== null &&
            (("role" in m && m.role === "user") || ("role" in m && m.role === "assistant")) &&
            "content" in m &&
            typeof m.content === "string",
        )
        .map(m => ({ ...m, content: m.content.slice(0, 2000) }))
        .slice(-MAX_HISTORY)
    : [];

  try {
    const systemPrompt = await buildContext();

    const stream = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: message.trim() },
      ],
      stream: true,
      temperature: 0.3,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        res.write(`data: ${JSON.stringify(token)}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ error: "AI service unavailable" });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

export default router;
