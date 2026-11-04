"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, FileDown, Loader2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/shared/form-message";
import { respondToContentAction } from "@/server/actions/public-content";

export type PublicItem = {
  id: string;
  topic: string;
  format: string;
  platforms: string;
  caption: string | null;
  date: string;
  status: string;
  publishedLink: string | null;
  image: string | null;
  file: { href: string; name: string } | null;
  link: string | null;
  note: { by: string | null; text: string } | null;
};

const BADGE: Record<string, { label: string; tone: "amber" | "green" | "red" | "blue" }> = {
  PENDING: { label: "Needs your answer", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  CHANGES_REQUESTED: { label: "We're making your changes", tone: "red" },
  PUBLISHED: { label: "Published", tone: "blue" },
};

export function ContentResponses({ token, items }: { token: string; items: PublicItem[] }) {
  const [name, setName] = useState("");
  const waiting = items.some((i) => i.status === "PENDING");
  return (
    <div className="space-y-4">
      {waiting && (
        <div className="glass space-y-1.5 rounded-2xl border p-4 sm:p-6">
          <Label htmlFor="responderName">Your name</Label>
          <Input id="responderName" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="sm:max-w-sm" />
          <p className="text-xs text-muted-foreground">We keep this with each of your answers.</p>
        </div>
      )}
      {items.map((item) => <Item key={item.id} token={token} item={item} name={name} />)}
    </div>
  );
}

function Item({ token, item, name }: { token: string; item: PublicItem; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const badge = BADGE[item.status] ?? BADGE.PENDING;

  const answer = (decision: "APPROVED" | "CHANGES_REQUESTED") =>
    start(async () => {
      setError(undefined);
      const res = await respondToContentAction({ token, itemId: item.id, decision, name, comment: decision === "CHANGES_REQUESTED" ? comment : "" });
      if (!res.ok) return setError(res.error);
      setAsking(false);
      router.refresh();
    });

  return (
    <article className="glass space-y-3 rounded-2xl border p-4 sm:p-6" aria-label={item.topic}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold break-words">{item.topic}</h2>
          <p className="text-xs text-muted-foreground">{item.date} · {item.format}{item.platforms && ` · ${item.platforms}`}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {item.image && (
        // A private file served through this link, so the image optimiser isn't used.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt={`Creative for ${item.topic}`} className="max-h-96 w-auto max-w-full rounded-lg border" />
      )}
      {item.caption && <p className="text-sm break-words whitespace-pre-wrap">{item.caption}</p>}
      {(item.file || item.link || item.publishedLink) && (
        <div className="flex flex-wrap gap-2">
          {item.file && <Button variant="outline" size="sm" asChild><a href={item.file.href}><FileDown /> {item.file.name}</a></Button>}
          {item.link && <Button variant="outline" size="sm" asChild><a href={item.link} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open the creative</a></Button>}
          {item.publishedLink && <Button variant="outline" size="sm" asChild><a href={item.publishedLink} target="_blank" rel="noopener noreferrer"><ExternalLink /> See it live</a></Button>}
        </div>
      )}
      {item.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap"><span className="font-medium">{item.note.by}:</span> {item.note.text}</p>}
      {item.status === "PENDING" && (
        <div className="space-y-2">
          <FormMessage error={error} />
          {asking ? (
            <div className="space-y-2">
              <Label htmlFor={`comment-${item.id}`}>What would you like changed?</Label>
              <Textarea id={`comment-${item.id}`} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setAsking(false); setError(undefined); }}>Cancel</Button>
                <Button disabled={pending} onClick={() => answer("CHANGES_REQUESTED")}>{pending && <Loader2 className="animate-spin" />} Send request</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="sm:flex-1" disabled={pending} onClick={() => answer("APPROVED")}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
              <Button className="sm:flex-1" variant="outline" disabled={pending} onClick={() => setAsking(true)}><MessageSquare /> Request changes</Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
