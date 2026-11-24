export default function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-mist">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger" role="alert">{error}</span>}
    </label>
  );
}

// Turns the API's [{ field, message }] list into { field: message }.
export const fieldErrors = (err) => Object.fromEntries((err?.errors || []).map((e) => [e.field, e.message]));
