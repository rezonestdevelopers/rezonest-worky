-- The offer email's subject now uses the agency name from Settings. Only changes it if it was never edited.
UPDATE "EmailTemplate"
SET "subject" = 'Quotation {{offerNumber}} from {{agencyName}}'
WHERE "key" = 'offer_send' AND "subject" = 'Quotation {{offerNumber}} from Rezonest Digital & Services';
