import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string") {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return Response.json(
        { error: "GROQ_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_completion_tokens: 700,
      messages: [
        {
          role: "system",
          content: `
You are Kapruka AI Concierge, a premium Sri Lankan shopping assistant.

Your job:
- Help users find gifts and products from Kapruka.
- Support English, Sinhala, and Tanglish.
- Ask for missing details like occasion, budget, delivery city, delivery date, and recipient.
- Keep replies short, warm, and useful.
- Do not invent exact Kapruka product names, prices, stock, delivery availability, or checkout links.
- For now, say that real Kapruka product cards will be connected next.
- Never create an order unless the user clearly confirms checkout.
          `,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Sorry, I could not generate a response.";

    return Response.json({
      reply,
    });
  } catch (error) {
    console.error("Groq chat API error:", error);

    return Response.json(
      {
        error: "Something went wrong while talking to Groq.",
      },
      { status: 500 }
    );
  }
}