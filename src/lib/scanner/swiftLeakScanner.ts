export const SCANNER_VERSION = "v0.4.1";

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

type SwiftBlock = {
  name: string;
  declaration: string;
  body: string;
  start: number;
  end: number;
};

type SwiftClassInfo = SwiftBlock & {
  topLevelBody: string;
};

// The code a lifecycle check looks at: one class plus its extensions, or the
// code outside any class (name is null).
type ScanScope = {
  name: string | null;
  body: string;
  topLevelBody: string;
};

type StrongReference = {
  propertyName: string;
  typeName: string;
  isWeakOrUnowned: boolean;
};

type ClosureProperty = {
  name: string;
  signature: string;
};

function stripSwiftComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function findMatchingBrace(
  code: string,
  openBraceIndex: number,
  open = "{",
  close = "}"
): number {
  let depth = 0;

  for (let index = openBraceIndex; index < code.length; index += 1) {
    const char = code[index];

    if (char === open) {
      depth += 1;
    }

    if (char === close) {
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

// blockRegex must be global, capture the name in group 1, and end at the
// block's opening brace.
function extractSwiftBlocks(code: string, blockRegex: RegExp): SwiftBlock[] {
  const blocks: SwiftBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(code)) !== null) {
    const openBraceIndex = match.index + match[0].length - 1;
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);

    if (closeBraceIndex === -1) {
      continue;
    }

    blocks.push({
      name: match[1],
      declaration: match[0],
      body: code.slice(openBraceIndex + 1, closeBraceIndex),
      start: match.index,
      end: closeBraceIndex + 1
    });

    blockRegex.lastIndex = closeBraceIndex + 1;
  }

  return blocks;
}

function extractSwiftClasses(code: string): SwiftClassInfo[] {
  // The lookahead skips `class func` / `class var`, which are not types.
  return extractSwiftBlocks(
    code,
    /\b(?:final\s+)?class\s+(?!func\b|var\b|let\b)(\w+)[^{]*\{/g
  ).map((block) => ({
    ...block,
    topLevelBody: getTopLevelClassBody(block.body)
  }));
}

function getScanScopes(code: string, classes: SwiftClassInfo[]): ScanScope[] {
  if (classes.length === 0) {
    return [
      { name: null, body: code, topLevelBody: getTopLevelClassBody(code) }
    ];
  }

  const extensions = extractSwiftBlocks(code, /\bextension\s+(\w+)[^{]*\{/g);
  const coveredRanges: Array<[number, number]> = [];

  const scopes: ScanScope[] = classes.map((swiftClass) => {
    const ownExtensions = extensions.filter(
      (extension) => extension.name === swiftClass.name
    );

    coveredRanges.push([swiftClass.start, swiftClass.end]);
    ownExtensions.forEach((extension) =>
      coveredRanges.push([extension.start, extension.end])
    );

    return {
      name: swiftClass.name,
      body: [swiftClass.body, ...ownExtensions.map((ext) => ext.body)].join(
        "\n"
      ),
      topLevelBody: swiftClass.topLevelBody
    };
  });

  coveredRanges.sort((a, b) => a[0] - b[0]);

  let remainingCode = "";
  let cursor = 0;

  for (const [start, end] of coveredRanges) {
    if (start > cursor) {
      remainingCode += `${code.slice(cursor, start)}\n`;
    }

    cursor = Math.max(cursor, end);
  }

  remainingCode += code.slice(cursor);

  if (remainingCode.trim()) {
    scopes.push({
      name: null,
      body: remainingCode,
      topLevelBody: getTopLevelClassBody(remainingCode)
    });
  }

  return scopes;
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

function getClosureProperties(classInfo: SwiftClassInfo): ClosureProperty[] {
  const properties: ClosureProperty[] = [];

  const closurePropertyRegex =
    /^\s*(?:(?:private|public|internal|fileprivate|open)\s+)?var\s+(\w+)\s*:\s*(\(\(.*?\)\s*->\s*.*?\)\?|\(\(.*?\)\s*->\s*Void\)\?|\(\(.*?\)\s*->\s*\w+\)\?)/gm;

  let match: RegExpExecArray | null;

  while ((match = closurePropertyRegex.exec(classInfo.topLevelBody)) !== null) {
    properties.push({
      name: match[1],
      signature: match[2]
    });
  }

  return properties;
}

function hasWeakOrUnownedSelfCapture(closureText: string): boolean {
  return /\{\s*\[[^\]]*(weak|unowned)\s+self[^\]]*\]/.test(closureText);
}

function hasWeakOrUnownedCapture(code: string, variableName: string): boolean {
  const weakPattern = new RegExp(
    `\\{\\s*\\[[^\\]]*(weak|unowned)\\s+${variableName}[^\\]]*\\]`
  );

  return weakPattern.test(code);
}

// closure must start at its opening brace. Checks only the closure's own
// capture list: a [weak self] in a nested closure still makes this one
// capture self strongly.
function capturesSelfStrongly(closure: string): boolean {
  const weakSelfCapture =
    /^\{\s*(?:@\w+\s+)?\[[^\]]*\b(?:weak|unowned(?:\([^)]*\))?)\s+self\b/;

  return !weakSelfCapture.test(closure) && /\bself\b/.test(closure);
}

function getTopLevelBraceBlocks(text: string): string[] {
  const blocks: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") {
      continue;
    }

    const closeBraceIndex = findMatchingBrace(text, index);

    if (closeBraceIndex === -1) {
      break;
    }

    blocks.push(text.slice(index, closeBraceIndex + 1));
    index = closeBraceIndex;
  }

  return blocks;
}

// Returns the closures passed to each call matched by callRegex: closure
// arguments inside the parentheses and any trailing closure. callRegex must
// be global and end at the call's opening "(" or "{".
function getCallClosures(code: string, callRegex: RegExp): string[] {
  const closures: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(code)) !== null) {
    let openIndex = match.index + match[0].length - 1;

    if (code[openIndex] === "(") {
      const closeParenIndex = findMatchingBrace(code, openIndex, "(", ")");

      if (closeParenIndex === -1) {
        continue;
      }

      closures.push(
        ...getTopLevelBraceBlocks(code.slice(openIndex + 1, closeParenIndex))
      );

      const trailingClosure = /^\s*\{/.exec(code.slice(closeParenIndex + 1));

      if (!trailingClosure) {
        continue;
      }

      openIndex = closeParenIndex + trailingClosure[0].length;
    }

    const closeBraceIndex = findMatchingBrace(code, openIndex);

    if (closeBraceIndex !== -1) {
      closures.push(code.slice(openIndex, closeBraceIndex + 1));
    }
  }

  return closures;
}

function getMethodBody(classBody: string, methodName: string): string | null {
  const methodRegex = new RegExp(
    `(?:override\\s+)?func\\s+${methodName}\\s*\\([^)]*\\)\\s*\\{`
  );

  const match = methodRegex.exec(classBody);

  if (!match) {
    return null;
  }

  const openBraceIndex = classBody.indexOf("{", match.index);
  const closeBraceIndex = findMatchingBrace(classBody, openBraceIndex);

  if (closeBraceIndex === -1) {
    return null;
  }

  return classBody.slice(openBraceIndex + 1, closeBraceIndex);
}

function sanitizeId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function addFindingOnce(findings: LeakFinding[], finding: LeakFinding): void {
  const alreadyExists = findings.some((item) => item.id === finding.id);

  if (!alreadyExists) {
    findings.push(finding);
  }
}

function getClosureAssignmentFindings(
  classInfo: SwiftClassInfo,
  fileName: string
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const closureAssignmentRegex =
    /(?:(?:let|var)\s+)?(?:(\w+)\.)?(\w+)\s*=\s*\{([\s\S]*?)\n\s*\}/g;

  let match: RegExpExecArray | null;

  while ((match = closureAssignmentRegex.exec(classInfo.body)) !== null) {
    const objectName = match[1];
    const closureName = match[2];
    const closureBody = match[3];
    const fullClosureText = match[0];

    const capturesSelf = /\bself\./.test(closureBody);

    if (!capturesSelf || hasWeakOrUnownedSelfCapture(fullClosureText)) {
      continue;
    }

    const targetName = objectName
      ? `${objectName}.${closureName}`
      : closureName;

    const isLocalCompletion = !objectName && closureName === "completion";

    const title = isLocalCompletion
      ? `${classInfo.name}.${closureName} closure captures ${classInfo.name} strongly`
      : `${targetName} captures ${classInfo.name} strongly`;

    const retainChain = objectName
      ? `${classInfo.name} → ${targetName} closure → ${classInfo.name}`
      : `${classInfo.name} → ${closureName} closure → ${classInfo.name}`;

    addFindingOnce(findings, {
      id: `specific-closure-capture-${sanitizeId(classInfo.name)}-${sanitizeId(
        targetName
      )}`,
      title,
      risk: "High",
      fileName,
      pattern: "Specific strong self closure capture",
      retainChain,
      whyItHappens:
        "This closure references self strongly. If the closure is stored by another object or by the same owner, the owner can remain in memory after the screen or object should deallocate.",
      fix: objectName
        ? `Use [weak self] in the ${targetName} closure and call self safely.`
        : `Use [weak self] in the ${closureName} closure and call self safely.`,
      verificationSteps: [
        `Add deinit print in ${classInfo.name}.`,
        `Update ${targetName} to capture self weakly.`,
        "Run the same navigation or repeated flow.",
        "Close the screen or release the object.",
        "Confirm deinit is called and Memory Graph no longer shows the retained object."
      ]
    });
  }

  return findings;
}

function getStoredClosureCollectionFindings(
  classInfo: SwiftClassInfo,
  fileName: string
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const closureCollectionRegex =
    /^\s*(?:(?:private|public|internal|fileprivate|open)\s+)?var\s+(\w+)\s*:\s*\[[^\]]*->\s*[^\]]+\]\s*=\s*(\[\]|\[:\])/gm;

  let collectionMatch: RegExpExecArray | null;

  while (
    (collectionMatch = closureCollectionRegex.exec(classInfo.topLevelBody)) !==
    null
  ) {
    const collectionName = collectionMatch[1];

    const appendPattern = new RegExp(`${collectionName}\\.append\\s*\\(`);
    // `handlers[id] = closure`, but not `handlers[id] = nil` or `==`.
    const dictionaryStorePattern = new RegExp(
      `${collectionName}\\s*\\[[^\\]]+\\]\\s*=(?!=)(?!\\s*nil\\b)`
    );

    const storesClosure =
      appendPattern.test(classInfo.body) || dictionaryStorePattern.test(classInfo.body);

    if (!storesClosure) {
      continue;
    }

    const hasCleanup =
      new RegExp(`${collectionName}\\.removeAll\\s*\\(`).test(classInfo.body) ||
      new RegExp(`${collectionName}\\.removeValue\\s*\\(`).test(classInfo.body) ||
      new RegExp(`${collectionName}\\s*\\[[^\\]]+\\]\\s*=\\s*nil\\b`).test(
        classInfo.body
      );

    if (hasCleanup) {
      continue;
    }

    const isSingleton = /static\s+let\s+shared\s*=/.test(classInfo.topLevelBody);

    addFindingOnce(findings, {
      id: `stored-closure-collection-${sanitizeId(classInfo.name)}-${sanitizeId(
        collectionName
      )}`,
      title: isSingleton
        ? `${classInfo.name}.shared stores callbacks in ${collectionName} without cleanup`
        : `${classInfo.name}.${collectionName} stores closures without cleanup`,
      risk: "High",
      fileName,
      pattern: "Stored escaping closure collection",
      retainChain: isSingleton
        ? `${classInfo.name}.shared → ${collectionName} → stored closure → captured objects`
        : `${classInfo.name} → ${collectionName} → stored closure → captured objects`,
      whyItHappens:
        "The class stores escaping closures inside an array or dictionary and no cleanup/removal was detected. If those closures capture self or other objects, memory can grow across repeated flows.",
      fix: "Avoid storing completion closures unless required. If storage is required, store them by identifier and remove each closure after execution or cancellation.",
      verificationSteps: [
        "Check whether the collection grows after repeated requests.",
        "Remove callbacks after execution.",
        "Run the flow multiple times.",
        "Monitor memory footprint and confirm it does not continuously increase.",
        "Use Memory Graph to check whether old closures remain retained."
      ]
    });
  }

  return findings;
}

function getPrepareForReuseFindings(
  classInfo: SwiftClassInfo,
  fileName: string
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const isCell =
    /UITableViewCell|UICollectionViewCell/.test(classInfo.declaration);

  if (!isCell) {
    return findings;
  }

  const closureProperties = getClosureProperties(classInfo);
  const hasLoaderProperty =
    /^\s*(?:(?:private|public|internal|fileprivate|open)\s+)?var\s+\w*loader\w*\s*:/gim.test(
      classInfo.topLevelBody
    );

  if (closureProperties.length === 0 && !hasLoaderProperty) {
    return findings;
  }

  const prepareForReuseBody = getMethodBody(classInfo.body, "prepareForReuse");

  if (!prepareForReuseBody) {
    addFindingOnce(findings, {
      id: `missing-prepare-for-reuse-${sanitizeId(classInfo.name)}`,
      title: `${classInfo.name} stores callbacks but does not implement prepareForReuse cleanup`,
      risk: "High",
      fileName,
      pattern: "Reusable cell cleanup risk",
      retainChain:
        "TableView/CollectionView → Reused Cell → old callback/loader → old owner",
      whyItHappens:
        "Reusable cells can keep old callbacks, loaders, or image requests alive if they are not cleared before reuse.",
      fix: "Implement prepareForReuse and clear closure callbacks, loader references, image references, and any pending request state.",
      verificationSteps: [
        "Scroll the list repeatedly.",
        "Check whether old cells remain in Memory Graph.",
        "Add prepareForReuse cleanup.",
        "Confirm callbacks and loader references are set to nil.",
        "Retest scrolling and screen dismissal."
      ]
    });

    return findings;
  }

  const missingClosureCleanups = closureProperties.filter((property) => {
    const nilPattern = new RegExp(`${property.name}\\s*=\\s*nil`);
    return !nilPattern.test(prepareForReuseBody);
  });

  const missingLoaderCleanup =
    hasLoaderProperty && !/\w*loader\w*\s*=\s*nil/i.test(prepareForReuseBody);

  if (missingClosureCleanups.length > 0 || missingLoaderCleanup) {
    const missingNames = [
      ...missingClosureCleanups.map((property) => property.name),
      ...(missingLoaderCleanup ? ["loader reference"] : [])
    ];

    addFindingOnce(findings, {
      id: `incomplete-prepare-for-reuse-${sanitizeId(classInfo.name)}`,
      title: `${classInfo.name} prepareForReuse may not clear stored callbacks/loaders`,
      risk: "High",
      fileName,
      pattern: "Incomplete reusable cell cleanup",
      retainChain:
        "TableView/CollectionView → Reused Cell → old closure/loader → old owner",
      whyItHappens:
        "The cell stores callbacks or loader references, but prepareForReuse does not appear to clear all of them. Old closures can keep previous owners, images, or loaders alive.",
      fix: `Clear these during prepareForReuse: ${missingNames.join(", ")}.`,
      verificationSteps: [
        "Add cleanup for all callback closures.",
        "Clear loader completion and loader back-references if present.",
        "Set image references to nil where applicable.",
        "Scroll the list repeatedly.",
        "Confirm reused cells do not keep old callbacks in Memory Graph."
      ]
    });
  }

  return findings;
}

function getCacheGrowthFindings(
  classInfo: SwiftClassInfo,
  fileName: string
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  const isSingleton = /static\s+let\s+shared\s*=/.test(classInfo.topLevelBody);
  const hasUIImageDictionary =
    /var\s+\w+\s*:\s*\[[^\]]*:\s*UIImage\]\s*=\s*\[:\]/.test(
      classInfo.topLevelBody
    );
  const usesNSCache = /NSCache\s*</.test(classInfo.body);
  const hasEviction =
    /removeAll\s*\(|removeValue\s*\(|countLimit|totalCostLimit/.test(
      classInfo.body
    );

  if (isSingleton && hasUIImageDictionary && !usesNSCache && !hasEviction) {
    addFindingOnce(findings, {
      id: `singleton-image-cache-growth-${sanitizeId(classInfo.name)}`,
      title: `${classInfo.name}.shared image dictionary may grow without eviction`,
      risk: "Medium",
      fileName,
      pattern: "Unbounded image cache growth",
      retainChain: `${classInfo.name}.shared → image dictionary → UIImage objects`,
      whyItHappens:
        "The singleton stores UIImage objects in a dictionary and no eviction or memory-pressure cleanup was detected. This can increase memory usage over repeated image loads.",
      fix: "Use NSCache for image caching or add explicit eviction, size limits, and memory warning cleanup.",
      verificationSteps: [
        "Load many unique images.",
        "Watch memory footprint in Xcode.",
        "Replace dictionary cache with NSCache or add eviction.",
        "Retest repeated flows.",
        "Confirm memory stabilizes instead of continuously growing."
      ]
    });
  }

  return findings;
}

// When the code that assigns a cell's callbacks is in the scan, the closure
// capture rules check those assignments directly. This rule only covers
// callbacks whose assignment the scanner cannot see.
function getCellCallbackFindings(
  classInfo: SwiftClassInfo,
  code: string,
  fileName: string
): LeakFinding[] {
  const isCell =
    /UITableViewCell|UICollectionViewCell/.test(classInfo.declaration);

  if (!isCell) {
    return [];
  }

  const unassignedCallbacks = getClosureProperties(classInfo)
    .map((property) => property.name)
    .filter((name) => !new RegExp(`\\.${name}\\s*=\\s*\\{`).test(code));

  if (unassignedCallbacks.length === 0) {
    return [];
  }

  const callbackNames = unassignedCallbacks.join(", ");

  return [
    {
      id: `cell-callback-retain-cycle-${sanitizeId(classInfo.name)}`,
      title: `Check how ${classInfo.name} callbacks are assigned`,
      risk: "Low",
      fileName,
      pattern: "Cell closure callback risk",
      retainChain: `ViewController → TableView/CollectionView → ${classInfo.name} → ${callbackNames} → ViewController`,
      whyItHappens: `${classInfo.name} stores callback closures (${callbackNames}), but the code that assigns them is not part of this scan. If the parent ViewController assigns them and captures self strongly, the ViewController may not deallocate.`,
      fix: "Use [weak self] when assigning these closures from the parent ViewController, and clear them in prepareForReuse. Scan the ViewController together with the cell to check the assignments.",
      verificationSteps: [
        "Add deinit print in the ViewController.",
        "Open the screen.",
        "Go back or dismiss the screen.",
        "Check if deinit is printed.",
        "Open Xcode Memory Graph and search for the ViewController."
      ]
    }
  ];
}

function getStrongDelegateProperties(scope: ScanScope): string[] {
  const names: string[] = [];
  const delegateRegex =
    /^[ \t]*((?:[@\w]+(?:\([^)]*\))?[ \t]+)*)var[ \t]+(\w*[dD]elegate)[ \t]*:[^\n{=]*(\{)?/gm;

  let match: RegExpExecArray | null;

  while ((match = delegateRegex.exec(scope.topLevelBody)) !== null) {
    const modifiers = match[1];
    const propertyName = match[2];
    const hasAccessorBlock = Boolean(match[3]);

    if (/\b(?:weak|unowned)\b/.test(modifiers)) {
      continue;
    }

    if (hasAccessorBlock) {
      // A computed property stores nothing. Observers (didSet/willSet) mean it is stored.
      const declarationIndex = scope.body.indexOf(match[0]);
      const openBraceIndex = declarationIndex + match[0].length - 1;
      const closeBraceIndex =
        declarationIndex === -1
          ? -1
          : findMatchingBrace(scope.body, openBraceIndex);
      const accessorBlock =
        closeBraceIndex === -1
          ? ""
          : scope.body.slice(openBraceIndex, closeBraceIndex + 1);

      if (!/\b(?:didSet|willSet)\b/.test(accessorBlock)) {
        continue;
      }
    }

    names.push(propertyName);
  }

  return names;
}

function getLifecycleFindings(
  scope: ScanScope,
  fileName: string
): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const { name, body } = scope;
  const idSuffix = name ? `-${sanitizeId(name)}` : "";

  if (/Timer\.scheduledTimer/.test(body) && !/\.invalidate\(\)/.test(body)) {
    findings.push({
      id: `timer-without-invalidate${idSuffix}`,
      title: name
        ? `Timer in ${name} may retain its target`
        : "Timer may retain its target",
      risk: "Medium",
      fileName,
      pattern: "Timer lifecycle risk",
      retainChain: `Timer → ${name ?? "Target/ViewController"}`,
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

  if (
    /NotificationCenter\.default\.addObserver/.test(body) &&
    !/NotificationCenter\.default\.removeObserver/.test(body)
  ) {
    findings.push({
      id: `notification-observer-lifecycle-risk${idSuffix}`,
      title: name
        ? `NotificationCenter observer lifecycle risk in ${name}`
        : "NotificationCenter observer lifecycle risk",
      risk: "Medium",
      fileName,
      pattern: "NotificationCenter observer risk",
      retainChain: `NotificationCenter → ${name ?? "Observer/ViewController"}`,
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

  if (getCallClosures(body, /\.sink\s*[({]/g).some(capturesSelfStrongly)) {
    findings.push({
      id: `combine-sink-self-capture${idSuffix}`,
      title: name
        ? `Combine sink in ${name} may capture self strongly`
        : "Combine sink may capture self strongly",
      risk: "High",
      fileName,
      pattern: "Combine sink self capture",
      retainChain: `${name ?? "Owner"} → AnyCancellable → sink closure → ${
        name ?? "self"
      }`,
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

  const taskClosures = getCallClosures(
    body,
    /\bTask(?:\.detached)?(?:<[^>]*>)?\s*(?:\([^)]*\)\s*)?\{/g
  );

  if (taskClosures.some(capturesSelfStrongly)) {
    findings.push({
      id: `async-task-self-capture${idSuffix}`,
      title: name
        ? `Async Task in ${name} may capture self strongly`
        : "Async Task may capture self strongly",
      risk: "Medium",
      fileName,
      pattern: "Async Task self capture",
      retainChain: `Task → closure → ${name ?? "self"}`,
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

  getStrongDelegateProperties(scope).forEach((propertyName) => {
    const propertyPath = name ? `${name}.${propertyName}` : propertyName;

    findings.push({
      id: `strong-delegate-risk${idSuffix}-${sanitizeId(propertyName)}`,
      title: `${propertyPath} may strongly retain its delegate`,
      risk: "Medium",
      fileName,
      pattern: "Strong delegate risk",
      retainChain: `${propertyPath} → delegate → Parent/ViewController`,
      whyItHappens:
        "Delegate references are usually expected to be weak. A strong delegate can create a retain cycle between parent and child objects.",
      fix: `Declare ${propertyName} as weak. If the compiler rejects it, make the delegate protocol class-bound with AnyObject.`,
      verificationSteps: [
        "Check the delegate protocol.",
        "Make the protocol class-bound using AnyObject if needed.",
        "Change the delegate property to weak.",
        "Verify the parent ViewController deallocates."
      ]
    });
  });

  return findings;
}

export function scanSwiftCode(
  rawCode: string,
  fileName = "Pasted Swift Code"
): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const code = stripSwiftComments(rawCode);

  const classes = extractSwiftClasses(code);
  const classNames = classes.map((swiftClass) => swiftClass.name);

  classes.forEach((swiftClass) => {
    getCellCallbackFindings(swiftClass, code, fileName).forEach((finding) =>
      addFindingOnce(findings, finding)
    );

    getClosureAssignmentFindings(swiftClass, fileName).forEach((finding) =>
      addFindingOnce(findings, finding)
    );

    getStoredClosureCollectionFindings(swiftClass, fileName).forEach(
      (finding) => addFindingOnce(findings, finding)
    );

    getPrepareForReuseFindings(swiftClass, fileName).forEach((finding) =>
      addFindingOnce(findings, finding)
    );

    getCacheGrowthFindings(swiftClass, fileName).forEach((finding) =>
      addFindingOnce(findings, finding)
    );
  });

  getScanScopes(code, classes).forEach((scope) => {
    getLifecycleFindings(scope, fileName).forEach((finding) =>
      addFindingOnce(findings, finding)
    );
  });

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
      addFindingOnce(findings, {
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