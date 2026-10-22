"use client";

/** Header checkbox that ticks every `name` checkbox in its own <form>. Not submitted itself. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="size-3.5 accent-primary"
      onChange={(e) => {
        const checked = e.currentTarget.checked;
        e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`).forEach((box) => {
          box.checked = checked;
        });
      }}
    />
  );
}
