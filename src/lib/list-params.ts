export const PAGE_SIZES = [10, 25, 50];

export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListParams<S extends string> {
  q: string;
  page: number;
  pageSize: number;
  sort: S;
  dir: "asc" | "desc";
}

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** An id from the URL. Anything that doesn't look like one is ignored. */
export function idParam(sp: SearchParams, key: string): string | undefined {
  const v = param(sp, key);
  return v && /^[a-z0-9]{10,40}$/i.test(v) ? v : undefined;
}

/** Reads search, page and sort from the URL. Only known columns can be sorted on. */
export function parseListParams<S extends string>(
  sp: SearchParams,
  opts: { sorts: readonly S[]; defaultSort: S; defaultDir: "asc" | "desc" },
): ListParams<S> {
  const sort = opts.sorts.find((s) => s === param(sp, "sort")) ?? opts.defaultSort;
  const dirParam = param(sp, "dir");
  const size = Number(param(sp, "size"));
  const page = Number(param(sp, "page"));
  return {
    q: (param(sp, "q") ?? "").trim().slice(0, 100),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : PAGE_SIZES[1],
    sort,
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : opts.defaultDir,
  };
}
