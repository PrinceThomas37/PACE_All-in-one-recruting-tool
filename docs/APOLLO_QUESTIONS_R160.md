# Questions for Apollo (R-160) — a draft for the owner to send; nothing has been sent

**Why ask.** Apollo's API terms (read 7 Oct 2026) license the API "solely for your internal business purposes", forbid sharing or
sublicensing it, and say a product may not "integrate the APIs … unless Apollo has authorized or approved such access". PACE is a
product sold to other recruiting companies, and its Lead Finder and POC finder call Apollo. Until Apollo answers in writing, the
safest reading is: Fute Global may use Apollo for its own staff; **other customers using Apollo through PACE is not clearly allowed**.

**Where it stands in PACE today (so the answers can be acted on).** Each customer company has its own Apollo key slot (R-067,
done 20 Oct): the founding company's key is used only for the founding company; a second company with no key gets nothing.
So the code already supports "every customer brings its own Apollo account". What Apollo's answer decides is whether that is
*allowed*, and by which route.

## The email (plain, short — edit freely)

> Subject: Partner / API question — recruiting software that uses Apollo for its customers
>
> Hello,
>
> We build PACE, a recruiting and lead-management product that we sell to other staffing and recruiting companies. Our own staff
> use Apollo today. As we add customers, we want to do this properly and would like your written answers to a few questions.
>
> 1. **Customers' own Apollo accounts.** If each customer connects *their own* Apollo account to PACE (their key, their credits),
>    is that permitted? If yes, do you require us to register as a partner application and use OAuth instead of customers pasting an API key?
> 2. **Reselling credits.** Is there a programme under which a software company buys Apollo credits or API access and lets its
>    customers spend them inside its product? What are the terms and cost?
> 3. **What we may show.** Are we allowed to display Apollo-sourced company and contact details inside PACE and let customers keep
>    them in their own records after they leave the product?
> 4. **Limits.** Are there rate limits or credit rules that differ for an application serving many separate customers?
> 5. **Who to talk to.** Is there a partnerships contact or an application form we should use?
>
> We would rather ask first than assume. Thank you.

## What each answer means for PACE

| Apollo says | What we do |
|---|---|
| Customers may connect their own account (with or without OAuth) | Keep the per-company key (done). If OAuth is required, build "Connect your Apollo" instead of a pasted key. |
| Resale is possible under a written agreement | A paid-by-PACE credit pool becomes possible; billing and limits per company follow (R-159). |
| Neither | Apollo stays for Fute Global's own staff only; other customers use the free job sources (R-164/R-166) and a different contact vendor behind the same finder interface. |
