import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Signed URLs for private photos the signed-in user's organization can read. */
export function usePhotoUrls(paths: (string | null | undefined)[]) {
  const clean = Array.from(new Set(paths.filter((p): p is string => !!p))).sort();
  return useQuery({
    queryKey: ["photo-urls", clean],
    enabled: clean.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.storage.from("photos").createSignedUrls(clean, 60 * 60);
      const map: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      return map;
    },
  });
}
