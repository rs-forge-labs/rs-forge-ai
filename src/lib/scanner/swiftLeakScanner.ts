export type RiskLevel = "Low" | "Medium" | "High";

export type LeakFinding = {
  id: string;
  title: string;
  risk: RiskLevel;
  pattern: string;
  retainChain: string;
  whyItHappens: string;
  fix: string;
  verificationSteps: string[];
};

export function scanSwiftCode(code: string): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const hasCellClass =
    /class\s+\w+\s*:\s*(UITableViewCell|UICollectionViewCell)/.test(code);

  const hasClosureProperty =
    /var\s+\w+\s*:\s*\(\(.*\)\s*->\s*.*\)\?/.test(code) ||
    /var\s+\w+\s*:\s*\(\(\)\s*->\s*Void\)\?/.test(code);

  if (hasCellClass && hasClosureProperty) {
    findings.push({
      id: "cell-callback-retain-cycle",
      title: "Possible cell callback retain cycle",
      risk: "High",
      pattern: "Cell closure callback risk",
      retainChain:
        "ViewController → TableView/CollectionView → Cell → Closure → ViewController",
      whyItHappens:
        "The cell owns a closure property. If the parent ViewController assigns this closure and captures self strongly, the ViewController may not deallocate.",
      fix: "Use [weak self] when assigning the closure from the parent ViewController.",
      verificationSteps: [
        "Add deinit print in the ViewController.",
        "Open the screen.",
        "Go back or dismiss the screen.",
        "Check if deinit is printed.",
        "Open Xcode Memory Graph and search for the ViewController."
      ]
    });
  }

  const hasStrongSelfInClosure = /\{\s*(?!\[weak self\]|\[unowned self\])[\s\S]*self\./.test(code);

  if (hasStrongSelfInClosure) {
    findings.push({
      id: "strong-self-capture",
      title: "Strong self captured inside closure",
      risk: "High",
      pattern: "Strong self capture",
      retainChain: "Owner object → Closure → self",
      whyItHappens:
        "The closure uses self strongly. If the closure is retained by another object, self can stay in memory longer than expected.",
      fix: "Use [weak self] or [unowned self] carefully based on lifecycle safety.",
      verificationSteps: [
        "Check where the closure is stored.",
        "Add [weak self] to the closure capture list.",
        "Run the flow again.",
        "Confirm deinit is called."
      ]
    });
  }

  const hasScheduledTimer = /Timer\.scheduledTimer/.test(code);
  const hasInvalidate = /\.invalidate\(\)/.test(code);

  if (hasScheduledTimer && !hasInvalidate) {
    findings.push({
      id: "timer-without-invalidate",
      title: "Timer may retain its target",
      risk: "Medium",
      pattern: "Timer lifecycle risk",
      retainChain: "Timer → Target/ViewController",
      whyItHappens:
        "A scheduled Timer can retain its target or closure. If it is not invalidated, the owner object may not release.",
      fix: "Invalidate the timer in deinit, viewWillDisappear, or cleanup method.",
      verificationSteps: [
        "Add timer?.invalidate() in deinit or cleanup.",
        "Run the screen flow.",
        "Close the screen.",
        "Check deinit and Memory Graph."
      ]
    });
  }

  return findings;
}