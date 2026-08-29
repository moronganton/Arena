"use client";
import { useEffect, useState } from "react";
import {
  LayoutTemplate, Loader2, AlertTriangle, ArrowLeft, Check, Trash2, Info,
  Download, Star, DoorOpen, Wrench, Wifi,
} from "lucide-react";
import { DEFAULT_RATE_PLAN_SET } from "@/lib/channels/rate-plan-spec";
import { reviewProblems, type ImportedPlan } from "@/lib/rate-plan-import";
import { channelDisplayName, type ChannelReadResult, type ChannelRoom } from "@/lib/channels/channel-rate-import";
import ChannexMappingFrame from "@/components/channels/ChannexMappingFrame";

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
  propertyName,
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
  propertyName: string;
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
  // What host24 records about this property on Channex, checked against
  // Channex. null while unknown or unreachable - which must render as silence,
  // not as an alarm.
  const [health, setHealth] = useState<
    { propertyExists: boolean; roomTypeExists: boolean; ratePlanExists: boolean; ok: boolean } | null
  >(null);
  const [repairing, setRepairing] = useState(false);
  // Opened straight from the "no channel connected" message. Sending someone
  // to another tab to fix what this screen just told them is broken is a
  // detour they have to remember to come back from.
  const [mapping, setMapping] = useState(false);
  // 409 from the read: the property is fine, it just has no channel attached
  // yet. The only error here with a one-click fix.
  const [needsChannel, setNeedsChannel] = useState(false);

  // Checked once, when setup opens on a property that already has a listing.
  // A listing pointing at a room type or rate plan that no longer exists is
  // the difference between "read your rate plans" working and Channex's own
  // mapping screen saying "No data" with no explanation anywhere.
  useEffect(() => {
    if (needsConnecting) return;
    let cancelled = false;
    fetch(`/api/channex/repair?propertyId=${propertyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.health) setHealth(d.health);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyId, needsConnecting]);

  async function repair() {
    setRepairing(true);
    setError(null);
    try {
      const res = await fetch("/api/channex/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Couldn't rebuild this property's channel setup.");
        return;
      }
      setHealth(data.health ?? null);
    } finally {
      setRepairing(false);
    }
  }

  // Asks the channel itself what this property sells. Creates nothing - the
  // endpoint behind this is a read, and provisioning still happens from
  // whatever the operator approves on the review screen.
  async function readFromChannel() {
    setError(null);
    setNeedsChannel(false);
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
        setNeedsChannel(res.status === 409);
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
            derivedAmount: p.derivedAmount ?? null,
            mealType: p.mealType ?? null,
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
            "Your channel manager didn't accept these rate plans."
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
        setError(flipData?.error ?? "Couldn't set this property up");
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
        setError(step?.error?.message ?? provData?.error ?? "Couldn't set this property up for sales channels");
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
          {alreadyFlagged ? "Finish setting this property up" : "Set this property up for sales channels"}
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          {alreadyFlagged
            ? "This property was never finished, so nothing can sync yet. host24 will set up its room type and a standard rate now."
            : "Before this property can sell on Booking.com or Airbnb, host24 sets it up for them — the property itself, its room type, and a standard rate."}{" "}
          Nothing goes on sale until you set prices and connect a channel.
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
          {connecting ? "Setting up…" : alreadyFlagged ? "Finish setting it up" : "Set up sales channels"}
        </button>
      </div>
    );
  }

  // ---------- broken listing ----------
  // Reached before the doors, because none of them can work: reading rate
  // plans, creating them and mapping a channel all need a room type and a rate
  // plan that really exist. Channex says "No data" in its mapping dropdown and
  // nothing else says anything, which reads as "a channel cannot be mapped
  // without a default rate" rather than "the objects are missing".
  if (health && !health.ok) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6">
        <h2 className="text-lg font-bold text-slate-900">This property&apos;s channel setup is incomplete</h2>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          host24 has this property set up for sales channels, but{" "}
          {!health.propertyExists
            ? "the property itself is no longer there."
            : !health.roomTypeExists && !health.ratePlanExists
              ? "its room type and rate plan are no longer there."
              : !health.roomTypeExists
                ? "its room type is no longer there."
                : "its rate plan is no longer there."}{" "}
          Until that is fixed, nothing can be sold or mapped to a channel — you will see an empty list
          when you try to connect one.
        </p>

        {error && (
          <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700 mt-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {health.propertyExists ? (
          <button
            onClick={repair}
            disabled={repairing}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition mt-5"
          >
            {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            {repairing ? "Rebuilding…" : "Rebuild what's missing"}
          </button>
        ) : (
          <p className="text-sm text-slate-500 mt-4 max-w-2xl">
            Recreating it automatically would leave the old property&apos;s reservations and channel
            connections behind and give you a second copy, so this one needs setting up again
            deliberately.
          </p>
        )}
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
          <div className="text-sm px-3.5 py-3 rounded-xl border bg-red-50 border-red-200 text-red-700 mt-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p>{error}</p>
                {needsChannel && (
                  <button
                    onClick={() => setMapping(true)}
                    className="flex items-center gap-1.5 bg-white hover:bg-red-100 border border-red-300 text-red-800 px-3 py-1.5 rounded-lg text-sm font-medium transition mt-2.5"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    Connect a channel now
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
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
          Reading from Booking.com needs the channel connected first — that is the{" "}
          <strong>Channels</strong> step, and you only do it once per property.
        </p>

        {mapping && (
          <ChannexMappingFrame
            propertyId={propertyId}
            propertyName={propertyName}
            onClose={() => {
              setMapping(false);
              // Straight back into the read. Closing the mapping window is the
              // moment the answer changes, and making someone press the same
              // button again to find out is the detour this replaced.
              setError(null);
              setNeedsChannel(false);
              readFromChannel();
            }}
          />
        )}

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

      {source === "channel" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Check these against Booking.com before you create them</p>
              <p className="mt-1">
                The names and structure below came straight from your channel, so those are right. The
                numbers did not — your channel sends no prices, minimum stays or policies at all. Open{" "}
                <strong>Property → Rates &amp; Availability → Rate plans</strong> in Booking.com and make
                sure each plan here matches it:
              </p>
              <ul className="list-disc pl-5 mt-1.5 space-y-0.5">
                <li>the price difference from your main rate — a percentage or a fixed amount</li>
                <li>the minimum number of nights</li>
                <li>which plans include breakfast</li>
              </ul>
              <p className="mt-1.5">
                Anything wrong here sells at the wrong price on every channel this property is on.
              </p>
            </div>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        The percentage is the <strong>difference</strong> from your main rate, not a share of it:{" "}
        <span className="tabular-nums font-medium text-slate-700">-10</span> is 10% cheaper,{" "}
        <span className="tabular-nums font-medium text-slate-700">+20</span> is 20% dearer. Same price
        as the main rate is not a separate product, so 0 is not allowed.
      </p>

      <div className="mt-3 space-y-2">
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
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Cheaper / dearer
              </label>
              {p.derivedPercent === null && p.derivedAmount == null && !p.needsPercent ? (
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
                    value={(p.derivedAmount ?? p.derivedPercent) ?? ""}
                    placeholder={p.derivedAmount != null ? "12" : "-10"}
                    onChange={(e) => {
                      // Number("-") and Number("") are NaN and 0 - one slips
                      // past every structural check and reaches Channex as
                      // null (a second parent), the other claims a price
                      // nobody entered. Anything not yet a real number is
                      // "still unanswered", which is what needsPercent means.
                      const n = Number(e.target.value);
                      const ok = e.target.value !== "" && Number.isFinite(n);
                      const asAmount = p.derivedAmount != null;
                      update(p.key, {
                        derivedPercent: ok && !asAmount ? n : null,
                        derivedAmount: ok && asAmount ? n : null,
                        needsPercent: !ok,
                      });
                    }}
                    className={`w-20 border rounded-lg px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      p.derivedPercent === null && p.derivedAmount == null
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200"
                    }`}
                  />
                  {/* Which unit the number is in. Booking.com states a price
                      difference as one or the other, so this mirrors it rather
                      than asking for both. */}
                  <select
                    value={p.derivedAmount != null ? "amount" : "percent"}
                    aria-label={`Price difference unit for ${p.title}`}
                    onChange={(e) => {
                      const toAmount = e.target.value === "amount";
                      const current = p.derivedAmount ?? p.derivedPercent;
                      update(p.key, {
                        derivedPercent: toAmount ? null : current,
                        derivedAmount: toAmount ? current : null,
                      });
                    }}
                    className="border border-slate-200 rounded-lg px-1.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="percent">%</option>
                    <option value="amount">{currency}</option>
                  </select>
                  <span className="text-xs text-slate-500">vs main</span>
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
