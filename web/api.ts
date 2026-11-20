export async function api(path: string, body?: unknown) {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "portfolio-app",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "The API is unavailable. Please retry shortly; check the backend connection if this continues.",
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function money(cents: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
  }).format(cents / 100);
}
