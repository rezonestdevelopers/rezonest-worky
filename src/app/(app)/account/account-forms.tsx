"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, KeyRound, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldNote } from "@/components/shared/form-fields";
import { changePasswordAction, updateMyProfileAction } from "@/server/actions/account";

export function ProfileCard(props: { name: string; phone: string; dailyDigest: boolean; emailOnTask: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone);
  const [dailyDigest, setDailyDigest] = useState(props.dailyDigest);
  const [emailOnTask, setEmailOnTask] = useState(props.emailOnTask);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setErrors({});
      const res = await updateMyProfileAction({ name, phone, dailyDigest, emailOnTask });
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) toast.error(res.error);
      }
    });
  return (
    <Card>
      <CardHeader><CardTitle>My details</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="myName">Name</Label>
            <Input id="myName" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <FieldNote error={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="myPhone">Phone</Label>
            <Input id="myPhone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
            <FieldNote error={errors.phone} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="myDigest">Daily email of my tasks</Label>
            <p className="text-xs text-muted-foreground">Sent each morning when something&apos;s due.</p>
          </div>
          <Switch id="myDigest" checked={dailyDigest} onCheckedChange={setDailyDigest} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="myTaskEmail">Email me when I&apos;m assigned or mentioned</Label>
            <p className="text-xs text-muted-foreground">You always get a notification in the app.</p>
          </div>
          <Switch id="myTaskEmail" checked={emailOnTask} onCheckedChange={setEmailOnTask} />
        </div>
        <div className="flex justify-end">
          <Button variant="outline" disabled={pending} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save details</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setErrors({});
      setError(undefined);
      const res = await changePasswordAction({ current, next, confirm });
      if (res.ok) {
        toast.success(res.message ?? "Changed");
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) setError(res.error);
      }
    });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 8 characters, with a letter and a number.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input id="currentPassword" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <FieldNote error={errors.current} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <FieldNote error={errors.next} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">New password again</Label>
            <Input id="confirmPassword" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <FieldNote error={errors.confirm} />
          </div>
        </div>
        <FieldNote error={error} />
        <div className="flex justify-end">
          <Button variant="outline" disabled={pending} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Change password</Button>
        </div>
      </CardContent>
    </Card>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Android and desktop Chrome can offer installing. iPhones only do it from Safari's Share menu. */
export function InstallCard() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) queueMicrotask(() => setInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return (
    <Card data-testid="install-card">
      <CardHeader>
        <div>
          <CardTitle>Install on your phone</CardTitle>
          <CardDescription>It opens from your home screen like any other app, without the browser bars.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {installed ? (
          <p className="font-medium">You&apos;re using the installed app.</p>
        ) : (
          <>
            {prompt && <Button onClick={() => { void prompt.prompt(); setPrompt(null); }}><Download /> Install the app</Button>}
            <p><span className="font-medium">Android:</span> in Chrome, open the ⋮ menu and choose Add to Home screen or Install app.</p>
            <p><span className="font-medium">iPhone:</span> in Safari, tap Share, then Add to Home Screen.</p>
            <p className="text-xs text-muted-foreground">Your phone only offers this once the app is online with a secure (https) address. Your data isn&apos;t kept on the phone, so you need a connection to use it.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
