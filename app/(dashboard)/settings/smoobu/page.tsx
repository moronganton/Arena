import { redirect } from "next/navigation";

// Smoobu settings folded into the unified Channels page when Channex became a
// second manager. Kept as a redirect so bookmarks and older in-app links do
// not dead-end.
export default function SmoobuSettingsRedirect() {
  redirect("/settings/channels");
}
