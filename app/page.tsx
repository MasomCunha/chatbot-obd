"use client";

import { useChat } from "ai/react";
import { useEffect, useRef } from "react";
import { Send, Bot, User, Loader2, Dog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, status, error, reload } =
    useChat();
  const isLoading = status === "submitted" || status === "streaming";

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-4">
      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Dog className="size-5" /> Chatbot de Obedicence PT 2026
          </CardTitle>
          <CardDescription>
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full px-6 py-4">
            <div className="flex flex-col gap-4">
              {messages.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Faz a tua pergunta sobre o regulamento de OBD.
                </p>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex gap-3",
                    m.role === "user" ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    {m.role === "user" ? (
                      <User className="size-4" />
                    ) : (
                      <Bot className="size-4" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> A pensar...
                </div>
              )}

              {error && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  <span>
                    {error.message ||
                      "⚠️ Ocorreu um erro. Tenta novamente daqui a pouco."}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => reload()}
                  >
                    Tentar novamente
                  </Button>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>
        </CardContent>

        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t p-4"
        >
          <Input
            value={input}
            onChange={handleInputChange}
            placeholder="Escreve a tua pergunta..."
            disabled={isLoading}
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </Card>
    </main>
  );
}
