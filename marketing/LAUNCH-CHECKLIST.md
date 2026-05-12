# PrepAura Launch Checklist

## Step 1 — Gumroad Setup (YOU do this, takes ~20 min)

- [ ] Go to gumroad.com → Create Account (use your email)
- [ ] New Product → Digital Product
- [ ] Name: "PrepAura — AI Interview Coach, Invisible to Screen Sharing"
- [ ] Price: $29
- [ ] Paste description from `marketing/gumroad-description.md`
- [ ] Upload: the `.dmg` file from `smart-overlay/dist/`
- [ ] Upload: the Windows `.exe` (when ready)
- [ ] Set product URL slug to: `prepaura` → final URL will be `prepaura.gumroad.com/l/prepaura`
- [ ] Paste refund policy from `marketing/email-templates.md` (section 3)
- [ ] Set receipt message from `marketing/email-templates.md` (section 4)
- [ ] Publish

## Step 2 — Landing Page (free GitHub Pages hosting)

- [ ] Create GitHub account if you don't have one
- [ ] New repository named: `prepaura` (must be public)
- [ ] Upload `marketing/landing/index.html` to repo root
- [ ] Settings → Pages → Source: main branch, root folder
- [ ] Wait 2 minutes → site live at `yourusername.github.io/prepaura`
- [ ] (Optional) Buy domain `prepaura.com` at Namecheap ~$10/yr and point it to GitHub Pages

## Step 3 — Build the App

```bash
cd "/Users/shabi/Documents/Coding/SmartUser copy/smart-overlay"
npm run build:mac
```
- DMG will be in `dist/` folder
- Upload DMG to Gumroad product

## Step 4 — Start Selling

- [ ] Post on Reddit using templates from `marketing/reddit-posts.md`
  - Start with r/cscareerquestions and r/leetcode
  - Space posts 1-2 days apart
- [ ] Share in relevant Discord servers (CS Career Hub, Blind community, etc.)
- [ ] Post on X/Twitter if you have an account

## Step 5 — Deliver Keys

- [ ] When someone buys on Gumroad, send them the key delivery email from `marketing/email-templates.md`
- [ ] Cross off the used key in `marketing/license-keys.txt`
- [ ] When you run out of keys: `node generate-keys.js 50` to generate 50 more

## Revenue Projection

| Sales/month | Monthly revenue |
|-------------|----------------|
| 10 sales    | $290            |
| 30 sales    | $870            |
| 100 sales   | $2,900          |

After Gumroad's 10% fee, you keep ~90%.

## Support Email
Set up: support@prepaura.com (use Gmail with custom alias or Namecheap email)
