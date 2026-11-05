import { addDaysKey } from "@/lib/dates";
import type { InvoiceInput } from "@/lib/validators/invoice";

export type InvoiceFormOptions = {
  clients: { value: string; label: string; stateCode: string; state: string; country: string }[];
  projects: { value: string; label: string; clientId: string }[];
  services: { value: string; label: string; rate: string; unit: string; gstRate: string; sacCode: string }[];
  agencyStateCode: string;
  defaultGstRate: string;
  defaultTermsDays: number;
  invoiceTerms: string;
  gstEnabledByDefault: boolean;
  hasGstin: boolean;
};

export const newInvoiceDefaults = (today: string, o: InvoiceFormOptions, clientId = ""): InvoiceInput => ({
  clientId,
  projectId: "",
  type: "TAX",
  gstEnabled: o.gstEnabledByDefault,
  invoiceDate: today,
  dueDate: addDaysKey(today, o.defaultTermsDays),
  terms: o.invoiceTerms,
  notes: "",
  items: [{ serviceId: "", description: "", sacCode: "", quantity: "1", unit: "", rate: "", discountType: "", discountValue: "", gstRate: o.defaultGstRate }],
});
