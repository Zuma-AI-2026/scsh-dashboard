"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

/** Submit button that shows a spinner while its parent <form action> is running. */
export function PendingButton({ children, pendingLabel, ...props }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
