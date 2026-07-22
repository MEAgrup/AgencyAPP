export async function GET() {
  return Response.json({
    status: "ok",
    service: "cdps-api",
  });
}
