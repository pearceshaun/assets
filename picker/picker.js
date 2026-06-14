/* Gousto picker template — rendered inside the visualize widget sandbox.
 *
 * The model streams only a small JSON data island (see SKILL.md, "The picker
 * widget"); this script renders the approved card layout from it and handles
 * Swap / Add / Remove / Details entirely client-side, so the only interaction
 * that costs a model round-trip is Confirm (and the rare Browse/Details).
 * Canonical source: skills/gousto-account/widget/picker.js in the claude repo;
 * published copy: picker/picker.js in pearceshaun/assets (pin by commit SHA).
 */
(function () {
  "use strict";

  var root = document.getElementById("gousto-picker");
  var dataEl = document.getElementById("gousto-data");
  if (!root || !dataEl) return;

  var D;
  try {
    D = JSON.parse(dataEl.textContent);
  } catch (e) {
    root.textContent = "Picker data failed to parse: " + e.message;
    return;
  }

  var picks = (D.picks || []).slice();
  var swaps = (D.swaps || []).slice();
  var minMeals = D.min_meals || 2;
  var maxMeals = D.max_meals || 5;
  var mode = D.mode || "subscription"; // "oneoff" = standalone transactional box
  var swapMode = null; // index of the pick currently being swapped
  var trail = [];      // human-readable log of changes, sent with Confirm

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function gbp(n) {
    return "£" + Number(n).toFixed(2);
  }

  function priceLine() {
    var p = D.pricing;
    if (!p || !p.per_portion_discounted) return "";
    var n = picks.length;
    var recipes = p.per_portion_discounted * n * (p.portions || 2);
    var total = recipes + (p.delivery || 0);
    var promo = p.per_portion && p.per_portion_discounted < p.per_portion
      ? ' <span class="gp-promo">(promo applied)</span>' : "";
    return '<div class="gp-price">' + n + " meals · " + (p.portions || 2) +
      " portions — " + gbp(recipes) + " recipes + " + gbp(p.delivery || 0) +
      " delivery = <strong>" + gbp(total) + "</strong>" + promo + "</div>";
  }

  function oneoffBanner() {
    if (mode !== "oneoff") return "";
    var bits = ["<strong>One-off box</strong>"];
    if (D.week) bits.push(esc(D.date_human || D.week));
    if (D.delivery_window) bits.push(esc(D.delivery_window));
    var express = D.is_express ? '<span class="gp-express">next-day</span>' : "";
    return '<div class="gp-oneoff"><i class="ti ti-package"></i>' + bits.join(" · ") +
      express + '<button class="gp-btn gp-datebtn" data-action="changedate">Change date</button>' +
      '<div class="gp-oneoff-note">Separate from your subscription · charged to your card on file at the cut-off</div>' +
      "</div>";
  }

  function header(r, big) {
    var icon = '<span class="gp-icon ti ' + esc(r.icon || "ti-chef-hat") + '"></span>';
    if (!D.img) return '<div class="gp-head gp-noimg">' + icon + "</div>";
    return '<div class="gp-head">' + icon +
      '<img loading="lazy" alt="" src="' + esc(D.img) + "/" + esc(r.core_id) +
      '.jpg" onerror="this.parentNode.classList.add(\'gp-noimg\')">' + "</div>";
  }

  function meta(r) {
    var bits = [];
    if (r.rating) bits.push('<span><i class="ti ti-star"></i>' + esc(r.rating) +
      (r.rating_count ? " (" + esc(r.rating_count) + ")" : "") + "</span>");
    if (r.my_rating) bits.push('<span class="gp-you" title="Your past rating">You ' +
      esc(r.my_rating) + "★</span>");
    if (r.prep) bits.push('<span><i class="ti ti-clock"></i>' + esc(r.prep) + " min</span>");
    if (r.kcal) bits.push('<span><i class="ti ti-flame"></i>' + esc(r.kcal) + " kcal</span>");
    (r.tags || []).forEach(function (t) { bits.push('<span class="gp-tag">' + esc(t) + "</span>"); });
    return '<div class="gp-meta">' + bits.join("") + "</div>";
  }

  function card(r, i) {
    var chip = r.stretch ? "Something new" : "Top match";
    var removable = picks.length > minMeals;
    return '<div class="gp-card' + (swapMode === i ? " gp-swapping" : "") + '">' +
      header(r, true) +
      '<span class="gp-chip' + (r.stretch ? " gp-stretch" : "") + '">' + chip + "</span>" +
      (removable ? '<button class="gp-x" data-action="remove" data-i="' + i +
        '" title="Remove this meal">×</button>' : "") +
      '<div class="gp-body"><div class="gp-title">' + esc(r.title) + "</div>" +
      meta(r) +
      (r.why ? '<div class="gp-why">' + esc(r.why) + "</div>" : "") +
      '<div class="gp-actions">' +
      '<button class="gp-btn" data-action="swapmode" data-i="' + i + '">' +
      (swapMode === i ? "Cancel swap" : "Swap") + "</button>" +
      '<button class="gp-btn" data-action="details" data-i="' + i + '">Details</button>' +
      "</div></div></div>";
  }

  function tile(r, j) {
    return '<button class="gp-tile" data-action="tile" data-j="' + j + '">' +
      header(r, false) +
      '<span class="gp-tile-title">' + esc(r.title) + "</span>" +
      '<span class="gp-tile-stat">' + (r.rating ? "★ " + esc(r.rating) + " · " : "") +
      esc(r.prep || "?") + " min</span></button>";
  }

  function render() {
    var canAdd = picks.length < maxMeals && swaps.length > 0;
    var hint = swapMode !== null
      ? "Tap an alternative below to swap it in."
      : (canAdd ? "Tap an alternative to add it as an extra meal (tap Swap on a card to exchange instead)." :
        "Tap Swap on a card, then an alternative below.");
    root.innerHTML =
      oneoffBanner() +
      '<div class="gp-grid">' + picks.map(card).join("") + "</div>" +
      (swaps.length ? '<div class="gp-swaprow"><div class="gp-swaphead">Likely swaps</div>' +
        '<div class="gp-swaplabel">' + esc(hint) + "</div><div class=\"gp-tiles\">" +
        swaps.map(tile).join("") + "</div></div>" : "") +
      '<div class="gp-footer">' +
      '<span class="gp-cutoff"><i class="ti ti-calendar"></i>' + esc(D.cutoff || "") + "</span>" +
      priceLine() +
      '<span class="gp-spacer"></span>' +
      '<button class="gp-btn" data-action="browse">Browse full menu</button>' +
      '<button class="gp-btn gp-primary" data-action="confirm">' +
      (mode === "oneoff" ? "Order " : "Confirm ") + picks.length + " meals</button>" +
      "</div>";
  }

  function confirmMessage() {
    var ids = picks.map(function (r) { return r.core_id; }).join(",");
    var titles = picks.map(function (r) { return '"' + r.title + '"'; }).join(", ");
    var msg;
    if (mode === "oneoff") {
      // Routes to `gousto.py oneoff-create --date <week> --core-ids <ids> --confirm`.
      msg = "Order a one-off Gousto box (deliver " + D.week + ", menu " + D.menu_id +
        "): " + picks.length + " meals, core ids " + ids + " — " + titles + ".";
    } else {
      msg = "Confirm my Gousto recipes for order " + D.order_id +
        " (deliver " + D.week + ", menu " + D.menu_id + "): " + picks.length +
        " meals, core ids " + ids + " — " + titles + ".";
    }
    if (trail.length) msg += " Changes made in the picker: " + trail.join("; ") + ".";
    return msg;
  }

  root.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var i = +btn.getAttribute("data-i");
    var j = +btn.getAttribute("data-j");
    if (action === "swapmode") {
      swapMode = swapMode === i ? null : i;
    } else if (action === "tile") {
      var incoming = swaps[j];
      if (swapMode !== null) {
        var outgoing = picks[swapMode];
        picks[swapMode] = incoming;
        swaps[j] = outgoing;
        trail.push('swapped out "' + outgoing.title + '" for "' + incoming.title + '"');
        swapMode = null;
      } else if (picks.length < maxMeals) {
        picks.push(incoming);
        swaps.splice(j, 1);
        trail.push('added "' + incoming.title + '" as an extra meal');
      }
    } else if (action === "remove") {
      if (picks.length > minMeals) {
        var gone = picks.splice(i, 1)[0];
        swaps.unshift(gone);
        trail.push('removed "' + gone.title + '"');
        if (swapMode !== null) swapMode = null;
      }
    } else if (action === "details") {
      var r = picks[i];
      if (typeof sendPrompt === "function")
        sendPrompt("Show details for Gousto recipe " + r.core_id + ' ("' + r.title + '")');
      return;
    } else if (action === "browse") {
      if (typeof sendPrompt === "function")
        sendPrompt(mode === "oneoff"
          ? "Browse the full Gousto menu for the one-off box on " + D.week
          : "Browse the full Gousto menu this week");
      return;
    } else if (action === "changedate") {
      if (typeof sendPrompt === "function")
        sendPrompt("Show me other available one-off Gousto delivery dates");
      return;
    } else if (action === "confirm") {
      if (typeof sendPrompt === "function") sendPrompt(confirmMessage());
      return;
    }
    render();
  });

  render();
})();
