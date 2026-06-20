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
      fix: "Use [weak self] when assigning the closure from the parent ViewController. Also consider clearing callback closures during prepareForReuse if the cell stores user action callbacks.",
      verificationSteps: [
        "Add deinit print in the ViewController.",
        "Open the screen.",
        "Go back or dismiss the screen.",
        "Check if deinit is printed.",
        "Open Xcode Memory Graph and search for the ViewController."
      ]
    });
  }

  const hasStrongSelfInClosure =
    /\{\s*(?!\[weak self\]|\[unowned self\])[\s\S]*self\./.test(code);

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
      fix: "Invalidate the timer in deinit, viewWillDisappear, or a dedicated cleanup method.",
      verificationSteps: [
        "Add timer?.invalidate() in deinit or cleanup.",
        "Run the screen flow.",
        "Close the screen.",
        "Check deinit and Memory Graph."
      ]
    });
  }

  const hasNotificationObserver = /NotificationCenter\.default\.addObserver/.test(code);
  const hasRemoveObserver = /NotificationCenter\.default\.removeObserver/.test(code);

  if (hasNotificationObserver && !hasRemoveObserver) {
    findings.push({
      id: "notification-observer-lifecycle-risk",
      title: "NotificationCenter observer lifecycle risk",
      risk: "Medium",
      pattern: "NotificationCenter observer risk",
      retainChain: "NotificationCenter → Observer/ViewController",
      whyItHappens:
        "Notification observers can keep callbacks active longer than expected. Selector-based observers should be removed when the object is deallocated or cleaned up.",
      fix: "Remove the observer in deinit or use block-based observers carefully with weak self and stored observer tokens.",
      verificationSteps: [
        "Check where addObserver is called.",
        "Add removeObserver in deinit if needed.",
        "Close the screen.",
        "Verify deinit is called.",
        "Trigger the notification again and confirm old screen does not respond."
      ]
    });
  }

  const hasCombineSink = /\.sink\s*\{[\s\S]*self\./.test(code);
  const hasWeakSelfInSink = /\.sink\s*\{\s*\[weak self\]/.test(code);

  if (hasCombineSink && !hasWeakSelfInSink) {
    findings.push({
      id: "combine-sink-self-capture",
      title: "Combine sink may capture self strongly",
      risk: "High",
      pattern: "Combine sink self capture",
      retainChain: "Owner → AnyCancellable → sink closure → self",
      whyItHappens:
        "Combine subscriptions are usually stored by the owner. If the sink closure captures self strongly, the owner can retain the subscription and the subscription can retain the owner.",
      fix: "Use [weak self] inside sink closures and store cancellables carefully.",
      verificationSteps: [
        "Find the sink closure.",
        "Add [weak self] to the sink capture list.",
        "Cancel subscriptions or clear cancellables when appropriate.",
        "Verify deinit is called after leaving the screen."
      ]
    });
  }

  const hasTaskSelfCapture = /Task\s*\{[\s\S]*self\./.test(code);
  const hasWeakSelfInTask = /Task\s*\{\s*\[weak self\]/.test(code);

  if (hasTaskSelfCapture && !hasWeakSelfInTask) {
    findings.push({
      id: "async-task-self-capture",
      title: "Async Task may capture self strongly",
      risk: "Medium",
      pattern: "Async Task self capture",
      retainChain: "Task → closure → self",
      whyItHappens:
        "A Task can keep its closure alive while async work is running. If the closure captures self strongly, the owner may stay in memory until the task completes or gets cancelled.",
      fix: "Use [weak self] where appropriate and cancel long-running tasks in deinit or lifecycle cleanup.",
      verificationSteps: [
        "Check whether the Task is long-running.",
        "Use [weak self] if the task belongs to a screen lifecycle.",
        "Store the task if cancellation is needed.",
        "Cancel the task when the screen closes.",
        "Verify deinit is called."
      ]
    });
  }

  const hasDelegateProperty = /var\s+\w*delegate\w*\s*:\s*\w+\??/.test(code);
  const hasWeakDelegate = /weak\s+var\s+\w*delegate\w*/.test(code);

  if (hasDelegateProperty && !hasWeakDelegate) {
    findings.push({
      id: "strong-delegate-risk",
      title: "Delegate may be strongly retained",
      risk: "Medium",
      pattern: "Strong delegate risk",
      retainChain: "Object → delegate → Parent/ViewController",
      whyItHappens:
        "Delegate references are usually expected to be weak. A strong delegate can create a retain cycle between parent and child objects.",
      fix: "Declare delegate properties as weak when the delegate is a class-bound protocol.",
      verificationSteps: [
        "Check the delegate protocol.",
        "Make the protocol class-bound using AnyObject if needed.",
        "Change the delegate property to weak.",
        "Verify the parent ViewController deallocates."
      ]
    });
  }

  return findings;
}