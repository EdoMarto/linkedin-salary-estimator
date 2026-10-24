<p align="center">
  <img src="icons/128.png" alt="Salary Estimator for LinkedIn" width="88">
</p>

# Salary Estimator for LinkedIn

A Chrome extension that shows an estimated market salary range for the role on a LinkedIn profile.
It reads the role, seniority, company and location from the profile and asks Google Gemini for the
typical pay for that kind of job in that market. A small card appears in the bottom right of the page.

The number is an estimate for the role, not the real salary of that person. A person's actual pay is
private and unknown. Think of it like a quick Glassdoor lookup for whatever role you are looking at.

## What you need
A free Gemini API key. Get one at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
It stays in your browser and is only sent to Google when you ask for an estimate.

## Install
1. Download or clone this folder.
2. Open `chrome://extensions` and turn on Developer mode (top right).
3. Click Load unpacked and select the folder.
4. Click the extension icon, open Options, and paste your Gemini API key.

## Use
Open any profile at `linkedin.com/in/…`. A card shows in the bottom right with an "Estimate market salary"
button. Click it to get a range for the role, the location it used, and a confidence level. Estimates are
cached per profile for a month so you do not spend quota reopening the same page.

## How it works
- The content script reads the public text at the top of the profile (name, headline, location, experience).
- The background worker sends it to Gemini with structured output and gets back a currency, a min and a max,
  and a confidence level.
- Your API key lives in `chrome.storage` and is only used by the background worker, never exposed to the page.

## Notes
- This is a rough estimate from a language model. Treat it as a ballpark, not a fact.
- LinkedIn changes its page structure now and then. If the card stops reading the profile, the selectors to
  update are in `content/content.js` (`readProfileText`).
