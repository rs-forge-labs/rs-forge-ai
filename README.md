# RS Forge AI

AI-powered Swift memory leak analyzer for iOS developers.

RS Forge AI helps iOS developers detect common memory leak patterns, retain cycles, and lifecycle risks in Swift code.

## What We Are Building

RS Forge AI is starting as a simple Swift Memory Leak Analyzer.

User will paste Swift code and the tool will show:

- Memory leak risk
- Retain cycle pattern
- Possible retain chain
- Why the issue happens
- Suggested fix
- Xcode verification steps

## Current Version

Version: v0.1

Current features:

- Paste Swift code
- Analyze memory risk
- Show findings count
- Show highest risk
- Show scanner version
- Copy full report
- Load sample Swift code
- Privacy notice for beta testers

## Current Scanner Rules

RS Forge AI currently checks for:

1. Cell callback closure risk
2. Strong self captured inside closure
3. Timer without invalidate
4. NotificationCenter observer lifecycle risk
5. Combine sink self capture
6. Async Task self capture
7. Strong delegate risk

## Target Users

Initial target users:

- Junior iOS developers
- Mid-level iOS developers
- Swift learners
- UIKit developers
- Developers stuck in retain cycles
- Developers who do not understand Xcode Memory Graph
- iOS interview preparation learners
- Production iOS developers working on long-running flows

## Privacy Notice

Do not paste confidential company code, API keys, tokens, customer data, private URLs, or proprietary business logic.

For beta testing, use sanitized code samples only.

## Tech Stack

- Next.js
- TypeScript
- Tailwind CSS
- Static Swift scanner rules
- GitHub Codespaces
- Vercel deployment planned

## How To Run

Install dependencies:

npm install

Run development server:

npm run dev

Open:

http://localhost:3000

## Branch Strategy

main: production
develop: active development
feature/*: feature branches
fix/*: bug fixes

## Roadmap

### Phase 1: Swift Memory Leak Analyzer

- Paste Swift code
- Run scanner
- Show structured report
- Copy report
- Load sample code

### Phase 2: Guided iOS Leak Agent

- Beginner mode
- Developer mode
- Team review mode
- Better explanations
- More scanner rules

### Phase 3: Beta Testing

- Company and college testers
- Sanitized production-style examples
- Feedback collection
- Accuracy improvement

### Phase 4: Login and History

- Google login
- Saved scans
- Monthly usage limit
- Free and Pro plans

### Phase 5: AI Explanation Layer

- Scanner result plus AI explanation
- Improved code suggestions
- Self-hosted/open-source model exploration

### Phase 6: GitHub Repo Scanner

- Connect repository
- Scan Swift files
- Generate project memory risk report

### Phase 7: PR Review Bot

- GitHub PR comments
- Team rules
- Memory leak checks before merge

## First Milestone

RS Forge AI v0.1 live beta.

Success criteria:

- 10 beta testers
- 30+ scans
- 3+ useful findings
- Feedback from real iOS developers
- Validation for Rs 499/month paid beta

## Founder Note

RS Forge AI is inspired by real production iOS memory debugging experience from large food-ordering and kiosk applications, where memory growth, retain cycles, and long-running flows can create serious production issues.

The goal is to make iOS memory debugging easier by explaining not only what might be wrong, but why it happens and how to verify the fix.
