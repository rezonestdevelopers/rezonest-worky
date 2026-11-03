import { Mail, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

/** wa.me needs the number with country code and digits only. 10-digit numbers are taken as Indian. */
export function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

/** One-tap call, WhatsApp and email buttons. Handy on the phone. */
export function ContactLinks({ phone, whatsapp, email }: { phone?: string | null; whatsapp?: string | null; email?: string | null }) {
  const wa = whatsapp || phone;
  return (
    <div className="flex flex-wrap gap-1.5">
      {phone && (
        <Button variant="outline" size="sm" asChild>
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone /> Call</a>
        </Button>
      )}
      {wa && (
        <Button variant="outline" size="sm" asChild>
          <a href={whatsappLink(wa)} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a>
        </Button>
      )}
      {email && (
        <Button variant="outline" size="sm" asChild>
          <a href={`mailto:${email}`}><Mail /> Email</a>
        </Button>
      )}
    </div>
  );
}
