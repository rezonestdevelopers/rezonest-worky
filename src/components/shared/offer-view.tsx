import type { OfferDocument } from "@/lib/offer-document";

/** An offer as the client reads it. Used on the internal page and the public link, with the same figures as the PDF. */
export function OfferView({ doc }: { doc: OfferDocument }) {
  const r = doc.recipient;
  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-4 border-b pb-4 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase">Prepared for</div>
          <div className="font-semibold break-words">{r.name}</div>
          {r.contact && <div>{r.contact}</div>}
          {r.address && <div className="text-muted-foreground">{r.address}</div>}
          {r.state && <div className="text-muted-foreground">Place of supply: {r.state}</div>}
          {r.gstin && <div className="text-muted-foreground">GSTIN: {r.gstin}</div>}
        </div>
        <div className="sm:text-right">
          <div className="font-semibold">{doc.number}{doc.version > 1 ? ` (v${doc.version})` : ""}</div>
          <div className="text-muted-foreground">Date: {doc.offerDate}</div>
          <div className="text-muted-foreground">Valid until: {doc.validUntil}</div>
          {doc.durationMonths && <div className="text-muted-foreground">Duration: {doc.durationMonths} months</div>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold break-words">{doc.title}</h2>
        <ul className="divide-y rounded-lg border">
          {doc.lines.map((l, i) => (
            <li key={i} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:gap-4">
              <div className="min-w-0">
                <div className="font-medium break-words">{l.description}</div>
                <div className="text-xs text-muted-foreground">{l.details}</div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {l.quantity} × {l.rate}
                  {l.discount && ` · Discount ${l.discount}`}
                  {l.gst !== "—" && ` · GST ${l.gst}`}
                </div>
              </div>
              <div className="font-medium tabular-nums sm:text-right">{l.total}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="ml-auto w-full max-w-sm space-y-1">
        {doc.summary.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t-2 border-primary pt-2 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums" data-testid="offer-total">{doc.grandTotal}</span>
        </div>
        <p className="text-xs text-muted-foreground">{doc.amountInWords}</p>
        {doc.taxNote && <p className="text-xs text-muted-foreground">{doc.taxNote}</p>}
        {doc.retainerNote && <p className="text-xs text-muted-foreground">{doc.retainerNote}</p>}
      </div>

      {doc.milestones.length > 0 && (
        <div>
          <h3 className="mb-1 font-semibold">Payment milestones</h3>
          <ul className="space-y-1">
            {doc.milestones.map((m, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{m.name} ({m.percent})</span>
                <span className="tabular-nums">{m.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {doc.paymentTerms && (
        <div>
          <h3 className="mb-1 font-semibold">Payment terms</h3>
          <p className="whitespace-pre-wrap">{doc.paymentTerms}</p>
        </div>
      )}
      {doc.notes && (
        <div>
          <h3 className="mb-1 font-semibold">Notes</h3>
          <p className="whitespace-pre-wrap">{doc.notes}</p>
        </div>
      )}
      {doc.terms && (
        <div>
          <h3 className="mb-1 font-semibold">Terms &amp; conditions</h3>
          <p className="text-xs whitespace-pre-wrap text-muted-foreground">{doc.terms}</p>
        </div>
      )}
    </div>
  );
}
