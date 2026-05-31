import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { requireAuth } from "../middlewares/auth";
import { buildContext } from "../lib/context";

const router: IRouter = Router();

router.post("/ai/chat", requireAuth, async (req, res): Promise<void> => {
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
        .slice(-MAX_HISTORY)
    : [];

  try {
    const systemPrompt = await buildContext();
    const groq = new Groq({ apiKey: groqKey });

    const stream = await groq.chat.completions.create({
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
