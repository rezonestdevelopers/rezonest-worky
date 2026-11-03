"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Loader2, Paperclip, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { addChecklistItemAction, addCommentAction, addRevisionAction, logTimeAction, setChecklistItemAction, uploadTaskFileAction } from "@/server/actions/work";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        after?.();
        router.refresh();
      } else toast.error(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error);
    });
  return { pending, run };
}

export function ChecklistPanel({ taskId, items }: { taskId: string; items: { id: string; title: string; isDone: boolean }[] }) {
  const { pending, run } = useAct();
  const [title, setTitle] = useState("");
  const done = items.filter((i) => i.isDone).length;
  return (
    <Card>
      <CardHeader><CardTitle>Checklist{items.length > 0 && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{done}/{items.length}</span>}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={i.isDone} disabled={pending} onChange={(e) => run(() => setChecklistItemAction(i.id, e.target.checked, taskId))} />
                <span className={i.isDone ? "text-muted-foreground line-through" : ""}>{i.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) run(() => addChecklistItemAction({ taskId, title }), () => setTitle(""));
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an item…" aria-label="Add checklist item" className="h-8" />
          <Button type="submit" variant="outline" size="sm" disabled={pending || !title.trim()}><Plus /> Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function CommentsPanel({ taskId, comments }: { taskId: string; comments: { id: string; author: string; when: string; body: string }[] }) {
  const { pending, run } = useAct();
  const [body, setBody] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{c.author}</span> · {c.when}</div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) run(() => addCommentAction({ taskId, body }), () => setBody(""));
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Write a comment. Type @Priya to tell someone." aria-label="Write a comment" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending && <Loader2 className="animate-spin" />} Post comment</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function TimePanel({ taskId, today, logs, totalMinutes }: { taskId: string; today: string; logs: { id: string; who: string; date: string; minutes: number; note: string | null }[]; totalMinutes: number }) {
  const { pending, run } = useAct();
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState("");
  const fmt = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
  return (
    <Card>
      <CardHeader><CardTitle>Time logged<span className="ml-2 font-normal text-muted-foreground tabular-nums">{fmt(totalMinutes)}</span></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <form
          className="grid grid-cols-[1fr_5rem_auto] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => logTimeAction({ taskId, date, minutes: Number(minutes), note: "" }), () => setMinutes(""));
          }}
        >
          <div className="space-y-1"><Label htmlFor="logDate">Date</Label><Input id="logDate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-8" /></div>
          <div className="space-y-1"><Label htmlFor="logMinutes">Minutes</Label><Input id="logMinutes" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-8" /></div>
          <Button type="submit" variant="outline" size="sm" disabled={pending || !minutes}><Clock /> Log</Button>
        </form>
        {logs.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {logs.slice(0, 8).map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.date} · {l.who}</span><span className="tabular-nums">{fmt(l.minutes)}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RevisionsPanel({ taskId, revisions, deliverable, changeRequestHref }: { taskId: string; revisions: number; deliverable: { used: number; included: number } | null; changeRequestHref: string | null }) {
  const { pending, run } = useAct();
  const over = deliverable && deliverable.used > deliverable.included;
  return (
    <Card>
      <CardHeader><CardTitle>Revisions</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="tabular-nums">
            {deliverable ? <>{deliverable.used} of {deliverable.included} included</> : <>{revisions} on this task</>}
          </span>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => addRevisionAction(taskId))}><Repeat /> Add revision</Button>
        </div>
        {over && (
          <p role="status" className="rounded-md border border-tone-amber/30 bg-tone-amber/10 px-2 py-1.5 text-xs">
            More revisions than the offer includes.{" "}
            {changeRequestHref ? <a href={changeRequestHref} className="underline">Log a change request</a> : "Ask your manager to log a change request."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AttachmentsPanel({ taskId, files }: { taskId: string; files: { id: string; name: string; size: string }[] }) {
  const { pending, run } = useAct();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attachments</CardTitle>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Attach a file"
          data-testid="task-file"
          accept="image/png,image/jpeg,image/webp,application/pdf,.docx,.xlsx,.pptx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.set("taskId", taskId);
            fd.set("file", file);
            run(() => uploadTaskFileAction(fd), () => {
              if (input.current) input.current.value = "";
            });
          }}
        />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="animate-spin" /> : <Paperclip />} Attach</Button>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files yet. Images, PDF and Office files up to 5 MB.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {files.map((f) => <li key={f.id} className="flex justify-between gap-2"><a href={`/api/documents/${f.id}`} className="truncate underline">{f.name}</a><span className="shrink-0 text-xs text-muted-foreground">{f.size}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
