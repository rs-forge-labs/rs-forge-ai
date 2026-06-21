export type RiskLevel = "Low" | "Medium" | "High";

export type LeakFinding = {
  id: string;
  title: string;
  risk: RiskLevel;
  fileName: string;
  pattern: string;
  retainChain: string;
  whyItHappens: string;
  fix: string;
  verificationSteps: string[];
};

type SwiftClassInfo = {
  name: string;
  body: string;
  topLevelBody: string;
};

type StrongReference = {
  propertyName: string;
  typeName: string;
  isWeakOrUnowned: boolean;
};

function stripSwiftComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function findMatchingBrace(code: string, openBraceIndex: number): number {
  let depth = 0;

  for (let index = openBraceIndex; index < code.length; index += 1) {
    const char = code[index];

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function getTopLevelClassBody(classBody: string): string {
  const lines = classBody.split("\n");
  const topLevelLines: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const depthBeforeLine = depth;

    if (depthBeforeLine === 0) {
      topLevelLines.push(line);
    }

    for (const char of line) {
      if (char === "{") {
        depth += 1;
      }

      if (char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
  }

  return topLevelLines.join("\n");
}

function extractSwiftClasses(code: string): SwiftClassInfo[] {
  const classes: SwiftClassInfo[] = [];
  const classRegex = /class\s+(\w+)[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1];
    const openBraceIndex = code.indexOf("{", match.index);
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);

    if (closeBraceIndex === -1) {
      continue;
    }

    const body = code.slice(openBraceIndex + 1, closeBraceIndex);
    const topLevelBody = getTopLevelClassBody(body);

    classes.push({
      name,
      body,
      topLevelBody
    });

    classRegex.lastIndex = closeBraceIndex + 1;
  }

  return classes;
}

function getDirectStrongReferences(
  classInfo: SwiftClassInfo,
  knownClassNames: string[]
): StrongReference[] {
  const references: StrongReference[] = [];

  const propertyRegex =
    /^\s*(?:(?:private|public|internal|fileprivate|open)\s+)?(?:(weak|unowned)\s+)?(?:var|let)\s+(\w+)\s*(?::\s*([A-Z]\w+)\??|\s*=\s*([A-Z]\w+)\s*\()/gm;

  let match: RegExpExecArray | null;

  while ((match = propertyRegex.exec(classInfo.topLevelBody)) !== null) {
    const ownershipKeyword = match[1];
    const propertyName = match[2];
    const explicitType = match[3];
    const inferredType = match[4];
    const typeName = explicitType || inferredType;

    if (!typeName || !knownClassNames.includes(typeName)) {
      continue;
    }

    references.push({
      propertyName,
      typeName,
      isWeakOrUnowned:
        ownershipKeyword === "weak" || ownershipKeyword === "unowned"
    });
  }

  return references;
}

function hasWeakOrUnownedCapture(code: string, variableName: string): boolean {
  const weakPattern = new RegExp(
    `\\{\\s*\$begin:math:display$\[\^\\$end:math:display$]*(weak|unowned)\\s+${variableName}[^\\]]*\\]`
  );

  return weakPattern.test(code);
}

export function scanSwiftCode(
  rawCode: string,
  fileName = "Pasted Swift Code"
): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const code = stripSwiftComments(rawCode);

  const classes = extractSwiftClasses(code);
  const classNames = classes.map((swiftClass) => swiftClass.name);

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
      fileName,
      pattern: "Cell closure callback risk",
      retainChain:
        "ViewController → TableView/CollectionView → Cell → Closure → ViewController",
      whyItHappens:
        "The cell owns a closure property. If the parent ViewController assigns this closure and captures self strongly, the ViewController may not deallocate.",
      fix: "Use [weak self] when assigning the closure from the parent ViewController. Also clear callback closures during prepareForReuse if the cell stores user action callbacks.",
      verificationSteps: [
        "Add deinit print in the ViewController.",
        "Open the screen.",
        "Go back or dismiss the screen.",
        "Check if deinit is printed.",
        "Open Xcode Memory Graph and search for the ViewController."
      ]
    });
  }

  const strongSelfClosureMatches = Array.from(
    code.matchAll(
      /(?:\w+\.)?\w+\s*=\s*\{\s*(?!\[weak self\]|\[unowned self\])[^{}]*self\.[^{}]*\}/g
    )
  );

  if (strongSelfClosureMatches.length > 0) {
    findings.push({
      id: "strong-self-capture",
      title: "Strong self captured inside closure",
      risk: "High",
      fileName,
      pattern: "Strong self capture",
      retainChain: "Owner object → Closure → self",
      whyItHappens:
        "The closure uses self strongly. If the closure is stored by another object, self can stay in memory longer than expected.",
      fix: "Use [weak self] or [unowned self] carefully based on lifecycle safety.",
      verificationSteps: [
        "Check where the closure is assigned or stored.",
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
      fileName,
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

  const hasNotificationObserver = /NotificationCenter\.default\.addObserver/.test(
    code
  );
  const hasRemoveObserver =
    /NotificationCenter\.default\.removeObserver/.test(code);

  if (hasNotificationObserver && !hasRemoveObserver) {
    findings.push({
      id: "notification-observer-lifecycle-risk",
      title: "NotificationCenter observer lifecycle risk",
      risk: "Medium",
      fileName,
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
      fileName,
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
      fileName,
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
      fileName,
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

  const assignedClosureMatches = Array.from(
    code.matchAll(/(\w+)\.(\w+)\s*=\s*\{([\s\S]*?)\n\s*\}/g)
  );

  assignedClosureMatches.forEach((match) => {
    const objectName = match[1];
    const closureProperty = match[2];
    const closureBody = match[3];

    const closureUsesObject = new RegExp(`${objectName}\\.`).test(closureBody);
    const hasWeakCapture = hasWeakOrUnownedCapture(match[0], objectName);

    if (closureUsesObject && !hasWeakCapture) {
      findings.push({
        id: `object-closure-capture-${objectName}-${closureProperty}`,
        title: `Closure captures ${objectName} strongly`,
        risk: "High",
        fileName,
        pattern: "Object captured strongly inside its own closure",
        retainChain: `${objectName} → ${closureProperty} closure → ${objectName}`,
        whyItHappens:
          "The object owns a closure property, and that closure captures the same object strongly. This can create a retain cycle because the object keeps the closure alive and the closure keeps the object alive.",
        fix: `Use [weak ${objectName}] or [unowned ${objectName}] in the closure capture list, then access it safely.`,
        verificationSteps: [
          `Update the closure to capture ${objectName} weakly.`,
          "Dismiss or release the object.",
          "Add deinit print in the captured object if possible.",
          "Open Xcode Memory Graph and confirm the object is released."
        ]
      });
    }
  });

  const referenceMap = new Map<string, StrongReference[]>();

  classes.forEach((swiftClass) => {
    referenceMap.set(
      swiftClass.name,
      getDirectStrongReferences(swiftClass, classNames)
    );
  });

  classes.forEach((firstClass) => {
    const firstReferences = referenceMap.get(firstClass.name) || [];

    firstReferences.forEach((firstReference) => {
      if (firstReference.isWeakOrUnowned) {
        return;
      }

      const secondClassName = firstReference.typeName;
      const secondReferences = referenceMap.get(secondClassName) || [];

      const reverseReference = secondReferences.find(
        (reference) =>
          reference.typeName === firstClass.name && !reference.isWeakOrUnowned
      );

      if (!reverseReference) {
        return;
      }

      const findingId = `mutual-strong-reference-${firstClass.name}-${secondClassName}`;
      const reverseFindingId = `mutual-strong-reference-${secondClassName}-${firstClass.name}`;

      const alreadyAdded = findings.some(
        (finding) =>
          finding.id === findingId || finding.id === reverseFindingId
      );

      if (alreadyAdded) {
        return;
      }

      findings.push({
        id: findingId,
        title: `Mutual strong reference between ${firstClass.name} and ${secondClassName}`,
        risk: "High",
        fileName,
        pattern: "Two-way strong reference retain cycle",
        retainChain: `${firstClass.name}.${firstReference.propertyName} → ${secondClassName}.${reverseReference.propertyName} → ${firstClass.name}`,
        whyItHappens:
          "Both classes store direct strong references to each other. If neither side is weak or unowned, the objects may not deallocate even after external references are removed.",
        fix: `Make one side weak or unowned depending on lifecycle ownership. Usually, ${secondClassName}.${reverseReference.propertyName} should be weak if it is a back-reference.`,
        verificationSteps: [
          "Add deinit print statements in both classes.",
          "Create and link both objects.",
          "Set external references to nil.",
          "Confirm both deinit methods are called.",
          "If deinit is not called, make the back-reference weak or unowned."
        ]
      });
    });
  });

  return findings;
}