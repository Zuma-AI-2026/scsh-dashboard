"use client";

import { APP_ROLES, type AppRole } from "@/lib/auth/roles";

export function RoleSelect({
  email,
  role,
  disabled,
  action,
}: {
  email: string;
  role: AppRole;
  disabled?: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <select
        name="role"
        defaultValue={role}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
        aria-label={`Role for ${email}`}
      >
        {APP_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
