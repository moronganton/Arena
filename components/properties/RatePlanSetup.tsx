"use client";
import { useRef, useState } from "react";
import {
  Upload, LayoutTemplate, Loader2, AlertTriangle, ArrowLeft, Check, Trash2, Info,
  Download, Star, DoorOpen,
} from "lucide-react";
import { compressImage } from "@/lib/image";
import { DEFAULT_RATE_PLAN_SET } from "@/lib/channels/rate-plan-spec";
import { reviewProblems, type ImportedPlan, type ImportResult } from "@/lib/rate-plan-import";
import { channelDisplayName, type ChannelReadResult, type ChannelRoom } from "@/lib/channels/channel-rate-import";

// Setting up what a property sells, for someone who has never seen a rate plan.
//
// Before this, a new property's Rate plans tab said provisioning "is done from
// the rate-plan API" - true, and useless to anyone who is not holding a
// terminal. A property could not be finished from the UI at all.
//
// Three doors, and the recommended one asks for no understanding of rate plans
// and no typing: Booking.com already tells Channex this property's room types,
// plan names and which plan the others hang off, so host24 reads that straight
// from the channel. What the channel does NOT send is any number - percentage,
// minimum stay, cancellation policy - so those are asked for here, marked as
// unanswered rather than filled with a guess.
//
// The screenshot is the fallback for a property whose channel is not connected
// yet, and the template for one that is not on Booking.com at all.
//
// Nothing is created until the operator presses the button on the review
// screen, because the cost of a confident mistake is a property selling wrong
// on two channels.

type Stage = "connect" | "choose" | "reading" | "rooms" | "review";

interface EditablePlan extends ImportedPlan {
  key: string;
}

function withKeys(plans: ImportedPlan[]): EditablePlan[] {
  return plans.map((p, i) => ({ ...p, key: `${i}-${p.title}` }));
}

export default function RatePlanSetup({
  propertyId,
  currency,
  onCreated,
  // True when the property has no Channex listing yet - a brand new property
  // starts here, because rate plans cannot exist before the listing does.
  needsConnecting = false,
  // Already flagged CHANNEX but never provisioned: the flag flip is a no-op,
  // only the Channex objects are missing. Worth saying differently, because
  // "connect this property" reads as wrong to someone whose header already
  // says Channex connected.
  alreadyFlagged = false,
  // Re-running the import on a property that already sells something. The
  // family it produces REPLACES what is there, so the copy has to say so -
  // an operator arriving here from "Re-read from the channel" is not setting
  // a property up, they are about to overwrite a working configuration.
  replacing = false,
}: {
  propertyId: string;
  currency: string;
  onCreated: () => void;
  needsConnecting?: boolean;
  alreadyFlagged?: boolean;
  replacing?: boolean;
}) {
  const [stage, setStage] = useState<Stage>(needsConnecting ? "connect" : "choose");
  const [connecting, setConnecting] = useState(false);
  const [plans, setPlans] = useState<EditablePlan[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source, setSource] = useState<"channel" | "import" | "template">("template");
  // Set only when the channel returned more than one room type, so the
  // operator picks which one this property is instead of host24 guessing.
  const [rooms, setRooms] = useState<ChannelRoom[]>([]);
  const [channelName, setChannelName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readScreenshot(file: File) {
    setError(null);
    setStage("reading");
    try {
      const image = await compressImage(file);
      const res = await fetch("/api/channex/rate-plans/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, image }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't read that screenshot");
        setStage("choose");
        return;
      }
      const result = data as ImportResult;
      if (result.plans.length === 0) {
        setError(result.problems[0] ?? "No rate plans could be read from that image.");
        setStage("choose");
        return;
      }
      setPlans(withKeys(result.plans));
      setWarnings(result.warnings);
      setSource("import");
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file");
      setStage("choose");
    }
  }

  // Asks the channel itself what this property sells. Creates nothing - the
  // endpoint behind this is a read, and provisioning still happens from
  // whatever the operator approves on the review screen.
  async function readFromChannel() {
    setError(null);
    setStage("reading");
    try {
      const res = await fetch("/api/channex/rate-plans/read-from-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't read your rate plans from the channel");
        setStage("choose");
        return;
      }
      const result = data as ChannelReadResult & { channel?: string };
      if (result.problems.length > 0 || result.rooms.length === 0) {
        setError(result.problems[0] ?? "The channel didn't return any rate plans.");
        setStage("choose");
        return;
      }
      setChannelName(result.channel ? channelDisplayName(result.channel) : null);
      setWarnings(result.warnings);
      setSource("channel");
      setRooms(result.rooms);
      // One room type is the ordinary case and needs no question asked. Several
      // is a real fork - host24 maps one room type per property - so it is put
      // to the operator rather than resolved by taking the first.
      if (result.rooms.length === 1) {
        setPlans(withKeys(result.rooms[0].plans));
        setStage("review");
      } else {
        setStage("rooms");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server");
      setStage("choose");
    }
  }

  function chooseRoom(room: ChannelRoom) {
    setPlans(withKeys(room.plans));
    setStage("review");
  }

  /**
   * Repoint the family at a different main rate.
   *
   * The channel does not say which plan the others are priced against - it is
   * inferred - so the inference has to be correctable. Without this, a wrong
   * guess leaves the operator no move but starting over.
   */
  function makeParent(key: string) {
    setPlans((prev) => {
      const next = prev.map((p) =>
        p.key === key
          ? { ...p, derivedPercent: null, needsPercent: false }
          : p.derivedPercent === null
            ? { ...p, needsPercent: true }
            : p
      );
      const at = next.findIndex((p) => p.key === key);
      if (at > 0) next.unshift(...next.splice(at, 1));
      return next;
    });
  }

  function useTemplate() {
    setPlans(
      withKeys(
        DEFAULT_RATE_PLAN_SET.map((s) => ({
          ...s,
          cancellationPolicy: null,
          minStayWasRead: true, // the template's minimums are chosen, not guessed
        }))
      )
    );
    setWarnings([]);
    setSource("template");
    setStage("review");
  }

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/channex/rate-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          apply: true,
          retireExisting: true,
          specs: plans.map((p) => ({
            title: p.title,
            derivedPercent: p.derivedPercent,
            minStayArrival: p.minStayArrival,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      // Two gates, not one. The endpoint reports a failed apply in the body as
      // well as the status, and trusting res.ok alone is exactly what sent the
      // operator silently back to the start of setup: a rejected apply looked
      // like success, the re-read found no plans, and this screen remounted
      // with nothing explaining why.
      if (!res.ok || data?.applied === false) {
        setError(
          (data?.problems ?? []).join("; ") ||
            data?.error ||
            "Channex didn't accept these rate plans."
        );
        return;
      }
      onCreated();
    } finally {
      setCreating(false);
    }
  }

  function update(key: string, patch: Partial<EditablePlan>) {
    setPlans((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const flip = await fetch("/api/channex/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const flipData = await flip.json().catch(() => null);
      if (!flip.ok) {
        setError(flipData?.error ?? "Couldn't connect this property");
        return;
      }
      // Creates the property, room type and Standard Rate on Channex. Separate
      // call so a failure here is distinguishable from the flag flip above.
      const prov = await fetch(`/api/channex/provision?propertyId=${propertyId}&apply=true`);
      const provData = await prov.json().catch(() => null);
      if (!prov.ok) {
        const step = Array.isArray(provData?.steps)
          ? provData.steps.find((s: { status?: string }) => s?.status === "failed")
          : null;
        setError(step?.error?.message ?? provData?.error ?? "Couldn't set this property up on Channex");
        return;
      }
      setStage("choose");
      // The listing now exists, so the parent tab must re-read before it can
      // show anything that depends on it.
      onCreated();
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setConnecting(false);
    }
  }

  // ---------- connect ----------
  if (stage === "connect") {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6">
        <h2 className="text-lg font-bold text-slate-900">
          {alreadyFlagged ? "Finish setting this property up" : "Connect this property first"}
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {alreadyFlagged
            ? "This property is set to use Channex but was never created there, so nothing can sync yet. host24 will create it, its room type and a standard rate now."
            : "Rate plans live on your channel manager, so this property needs to exist there before it can sell anything. host24 will create it, its room type, and a standard rate."}{" "}
          Nothing goes on sale until you set prices.
        </p>

        {error && (
          <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700 mt-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={connect}
          disabled={connecting}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition mt-5"
        >
          {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {connecting ? "Setting up…" : alreadyFlagged ? "Create it on Channex" : "Set up on Channex"}
        </button>
      </div>
    );
  }

  // ---------- choose ----------
  if (stage === "choose") {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6">
        <h2 className="text-lg font-bold text-slate-900">
          {replacing ? "Replace what this property sells" : "What does this property sell?"}
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {replacing ? (
            <>
              Whatever you create here <strong>replaces</strong> this property&apos;s current rate
              plans. The old ones are renamed out of the way rather than deleted, so nothing that is
              already booked is lost — you can remove them afterwards.
            </>
          ) : (
            <>
              A rate plan is a product a guest can book — your standard rate, a cheaper non-refundable
              version, a weekly deal. If you already sell on Booking.com, you have these already.
            </>
          )}
        </p>

        {error && (
          <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700 mt-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-4 flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-indigo-600 px-2 py-0.5 rounded-full self-start">
              Recommended
            </span>
            <h3 className="font-semibold text-slate-900">Read from Booking.com</h3>
            <p className="text-sm text-slate-600 flex-1">
              Your channel already tells host24 which rate plans this property sells. Names and
              structure come across exactly — you only confirm the discounts.
            </p>
            <button
              onClick={readFromChannel}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition self-start"
            >
              <Download className="w-4 h-4" />
              Read my rate plans
            </button>
          </div>

          <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
            <h3 className="font-semibold text-slate-900">Upload a screenshot</h3>
            <p className="text-sm text-slate-600 flex-1">
              Not connected to Booking.com yet? Screenshot your rate plans page and host24 reads it —
              names, discounts and minimum stays.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium transition self-start"
            >
              <Upload className="w-4 h-4" />
              Upload a screenshot
            </button>
          </div>

          <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
            <h3 className="font-semibold text-slate-900">Start from a template</h3>
            <p className="text-sm text-slate-600 flex-1">
              Six products most short-stay operators use: standard, non-refundable, weekly, monthly and
              two short-stay rates. Change anything afterwards.
            </p>
            <button
              onClick={useTemplate}
              className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium transition self-start"
            >
              <LayoutTemplate className="w-4 h-4" />
              See the template
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-4">
          For a screenshot, go to <strong>Property → Rates &amp; Availability → Rate plans</strong> in
          Booking.com and capture the whole list.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readScreenshot(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  // ---------- reading ----------
  if (stage === "reading") {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        <p className="text-sm font-medium text-slate-700">Reading your rate plans…</p>
        <p className="text-xs text-slate-500">Nothing is created until you confirm.</p>
      </div>
    );
  }

  // ---------- rooms ----------
  // Only reached when the channel returned more than one room type. host24
  // manages one room type per property, so this is a question, not a step that
  // can be skipped by taking the first.
  if (stage === "rooms") {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6">
        <button
          onClick={() => { setStage("choose"); setError(null); }}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Start over
        </button>

        <h2 className="text-lg font-bold text-slate-900">Which room is this property?</h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {channelName ?? "Your channel"} lists {rooms.length} room types under this connection. host24
          manages one per property, so pick the one this is — the others belong to their own properties.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
          {rooms.map((room) => (
            <button
              key={room.channelRoomId ?? room.title}
              onClick={() => chooseRoom(room)}
              className="border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 rounded-xl p-4 text-left transition"
            >
              <div className="flex items-center gap-2">
                <DoorOpen className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-900">{room.title}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {room.plans.length} rate plan{room.plans.length === 1 ? "" : "s"}
                {room.channelRoomId && ` · id ${room.channelRoomId}`}
              </p>
              <p className="text-sm text-slate-600 mt-2">
                {room.plans.map((pl) => pl.title).join(", ")}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- review ----------
  // Recomputed from the plans on every edit rather than held from the read.
  // A message that cannot clear when the operator fixes what it names is worse
  // than no message: it disables Create with no way forward but starting over.
  const problems = reviewProblems(plans);
  const blocked = problems.length > 0 || plans.length === 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6">
      <button
        onClick={() => { setStage("choose"); setError(null); }}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Start over
      </button>

      <h2 className="text-lg font-bold text-slate-900">
        {source === "template"
          ? "The standard template"
          : `Found ${plans.length} rate plan${plans.length === 1 ? "" : "s"}`}
      </h2>
      <p className="text-sm text-slate-600 mt-1 max-w-2xl">
        {source === "channel" ? (
          <>
            These names came straight from {channelName ?? "your channel"}, so they are exactly right.
            What it doesn&apos;t send is the numbers — fill in how each plan is priced against your main
            rate, and check the minimum stays.
          </>
        ) : source === "import" ? (
          "Check these against your extranet, change anything that's wrong, then create them."
        ) : (
          "Change anything you like before creating them."
        )}
      </p>

      {problems.length > 0 && (
        <div className="mt-4 text-sm px-3.5 py-2.5 rounded-xl border bg-red-50 border-red-200 text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold mb-1">These need fixing first</p>
              <ul className="list-disc pl-4 space-y-1">
                {problems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 text-sm px-3.5 py-2.5 rounded-xl border bg-amber-50 border-amber-200 text-amber-800">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <ul className="space-y-1">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {plans.map((p) => (
          <div key={p.key} className="border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Name</label>
              <input
                value={p.title}
                onChange={(e) => update(p.key, { title: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Price</label>
              {p.derivedPercent === null && !p.needsPercent ? (
                <span className="inline-block text-xs font-bold uppercase tracking-wide px-2 py-1.5 rounded bg-indigo-50 text-indigo-700">
                  Your main rate
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  {/* Empty, not zero. A blank box is the honest rendering of a
                      number the channel never sent; 0 would read as "same price
                      as the main rate", which is a claim nobody made. */}
                  <input
                    type="number"
                    value={p.derivedPercent ?? ""}
                    placeholder="?"
                    onChange={(e) => {
                      // Number("-") and Number("") are NaN and 0 - one slips
                      // past every structural check and reaches Channex as
                      // null (a second parent), the other claims a price
                      // nobody entered. Anything not yet a real number is
                      // "still unanswered", which is what needsPercent means.
                      const n = Number(e.target.value);
                      const ok = e.target.value !== "" && Number.isFinite(n);
                      update(p.key, { derivedPercent: ok ? n : null, needsPercent: !ok });
                    }}
                    className={`w-20 border rounded-lg px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      p.derivedPercent === null ? "border-amber-300 bg-amber-50" : "border-slate-200"
                    }`}
                  />
                  <span className="text-xs text-slate-500">% of main</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Min nights
                {!p.minStayWasRead && <span className="ml-1 text-amber-600 font-semibold">· suggested</span>}
              </label>
              <input
                type="number"
                min="1"
                value={p.minStayArrival}
                onChange={(e) =>
                  // Floored: the API takes an integer, and "2.5" typed into a
                  // number input reaches it as 2.5 and comes back a 400 whose
                  // message says nothing about which field was wrong.
                  update(p.key, { minStayArrival: Math.max(1, Math.floor(Number(e.target.value)) || 1) })
                }
                className={`w-20 border rounded-lg px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  p.minStayWasRead ? "border-slate-200" : "border-amber-300 bg-amber-50"
                }`}
              />
            </div>
            {p.cancellationPolicy && (
              <div className="text-[11px] text-slate-500 self-center">
                <span className="block font-medium text-slate-600">{p.cancellationPolicy}</span>
                stays on Booking.com
              </div>
            )}
            {plans.length > 1 && (p.derivedPercent !== null || p.needsPercent) && (
              <button
                onClick={() => makeParent(p.key)}
                title="Make this the main rate"
                aria-label={`Make ${p.title} the main rate`}
                className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 self-center"
              >
                <Star className="w-4 h-4" />
              </button>
            )}
            {plans.length > 1 && (
              <button
                onClick={() => setPlans((prev) => prev.filter((x) => x.key !== p.key))}
                aria-label={`Remove ${p.title}`}
                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 self-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700 mt-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mt-5 flex-wrap">
        <button
          onClick={create}
          disabled={creating || blocked}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {creating ? "Creating…" : `Create ${plans.length} rate plan${plans.length === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-slate-500">
          Prices in {currency}. These go live on your connected channels.
        </span>
      </div>
    </div>
  );
}
