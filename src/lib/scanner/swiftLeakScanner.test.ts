import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sampleSwiftCode } from "./sampleSwiftCode.ts";
import { scanSwiftCode } from "./swiftLeakScanner.ts";

function findingIds(code: string): string[] {
  return scanSwiftCode(code, "Test.swift").map((finding) => finding.id);
}

test("demo sample reports both planted leaks and nothing else", () => {
  assert.deepEqual(findingIds(sampleSwiftCode).sort(), [
    "mutual-strong-reference-ClassA-ClassB",
    "object-closure-capture-modalViewController-closeActionHandler"
  ]);
});

describe("reusable cells", () => {
  const cleanCell = `
class MyCell: UITableViewCell {
    var onTap: (() -> Void)?

    override func prepareForReuse() {
        super.prepareForReuse()
        onTap = nil
    }
}`;

  test("a correct cell scanned alone only gets a Low reminder", () => {
    const findings = scanSwiftCode(cleanCell, "MyCell.swift");

    assert.deepEqual(
      findings.map((finding) => [finding.id, finding.risk]),
      [["cell-callback-retain-cycle-mycell", "Low"]]
    );
  });

  test("missing prepareForReuse is reported", () => {
    const code = `
class MyCell: UITableViewCell {
    var onTap: (() -> Void)?
}`;

    assert.ok(findingIds(code).includes("missing-prepare-for-reuse-mycell"));
  });

  test("prepareForReuse that does not clear the callback is reported", () => {
    const code = `
class MyCell: UITableViewCell {
    var onTap: (() -> Void)?

    override func prepareForReuse() {
        super.prepareForReuse()
    }
}`;

    const ids = findingIds(code);
    assert.ok(ids.includes("incomplete-prepare-for-reuse-mycell"));
    assert.ok(!ids.includes("missing-prepare-for-reuse-mycell"));
  });

  test("callback assigned with [weak self] produces no findings", () => {
    const code = `${cleanCell}

class ListViewController: UIViewController {
    func configure(_ cell: MyCell) {
        cell.onTap = { [weak self] in
            self?.openDetail()
        }
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("callback assigned with strong self is reported at the assignment", () => {
    const code = `${cleanCell}

class ListViewController: UIViewController {
    func configure(_ cell: MyCell) {
        cell.onTap = {
            self.openDetail()
        }
    }
}`;

    assert.deepEqual(findingIds(code), [
      "specific-closure-capture-listviewcontroller-cell-ontap"
    ]);
  });
});

describe("closures that capture their owner", () => {
  test("[unowned vc] is not reported", () => {
    const code = `
class Host {
    func show(_ vc: ModalViewController) {
        vc.onClose = { [unowned vc] in
            vc.dismiss(animated: true)
        }
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("strong capture of the owner is reported", () => {
    const code = `
class Host {
    func show(_ vc: ModalViewController) {
        vc.onClose = {
            vc.dismiss(animated: true)
        }
    }
}`;

    assert.deepEqual(findingIds(code), ["object-closure-capture-vc-onClose"]);
  });
});

describe("stored closure dictionaries", () => {
  const store = (extraMethods: string) => `
class RequestStore {
    var handlers: [String: () -> Void] = [:]

    func add(id: String, handler: @escaping () -> Void) {
        handlers[id] = handler
    }
${extraMethods}
}`;

  test("closures stored by key and never removed are reported", () => {
    assert.deepEqual(findingIds(store("")), [
      "stored-closure-collection-requeststore-handlers"
    ]);
  });

  test("closures removed with handlers[id] = nil are not reported", () => {
    const cleanup = `
    func finish(id: String) {
        handlers[id]?()
        handlers[id] = nil
    }`;

    assert.deepEqual(findingIds(store(cleanup)), []);
  });
});

describe("lifecycle checks are per class", () => {
  test("only the class that never invalidates its timer is reported", () => {
    const code = `
class PollerA {
    var timer: Timer?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
    }

    deinit {
        timer?.invalidate()
    }
}

class PollerB {
    var timer: Timer?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
    }
}`;

    assert.deepEqual(findingIds(code), ["timer-without-invalidate-pollerb"]);
  });

  test("invalidate in an extension of the same class counts", () => {
    const code = `
class Poller {
    var timer: Timer?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
    }
}

extension Poller {
    func stop() {
        timer?.invalidate()
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("an extension of a class outside the scan is still checked", () => {
    const code = `
class Helper {}

extension FeedViewController {
    func startPolling() {
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in }
    }
}`;

    assert.deepEqual(findingIds(code), ["timer-without-invalidate"]);
  });

  test("a snippet with no type declarations is still checked", () => {
    const code = `
func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
}`;

    assert.deepEqual(findingIds(code), ["timer-without-invalidate"]);
  });

  test("class func is not mistaken for a class declaration", () => {
    const code = `
extension Poller {
    class func make() -> Poller {
        let poller = Poller()
        poller.timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
        return poller
    }
}`;

    assert.deepEqual(findingIds(code), ["timer-without-invalidate"]);
  });

  test("only the class that never removes its observer is reported", () => {
    const code = `
class CartBadge {
    init() {
        NotificationCenter.default.addObserver(self, selector: #selector(update), name: .cartChanged, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

class OrderBanner {
    init() {
        NotificationCenter.default.addObserver(self, selector: #selector(update), name: .cartChanged, object: nil)
    }
}`;

    assert.deepEqual(findingIds(code), [
      "notification-observer-lifecycle-risk-orderbanner"
    ]);
  });
});

describe("Task and sink closures are checked one by one", () => {
  test("a strong Task is reported even when another Task uses [weak self]", () => {
    const code = `
class FeedViewModel {
    func refresh() {
        Task { [weak self] in
            await self?.load()
        }
    }

    func preload() {
        Task {
            await self.load()
        }
    }
}`;

    assert.deepEqual(findingIds(code), ["async-task-self-capture-feedviewmodel"]);
  });

  test("Task(priority:) with [weak self] is not reported", () => {
    const code = `
class FeedViewModel {
    func refresh() {
        Task(priority: .userInitiated) { [weak self] in
            guard let self else { return }
            await self.load()
        }
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("sink(receiveValue:) with [weak self] is not reported", () => {
    const code = `
class SearchViewModel {
    func bind() {
        query.sink(receiveValue: { [weak self] text in
            self?.search(text)
        }).store(in: &cancellables)
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("strong self in a trailing or argument sink closure is reported", () => {
    const trailing = `
class SearchViewModel {
    func bind() {
        query.sink { text in
            self.search(text)
        }.store(in: &cancellables)
    }
}`;

    const argument = `
class SearchViewModel {
    func bind() {
        query.sink(receiveCompletion: { _ in }, receiveValue: { text in
            self.search(text)
        }).store(in: &cancellables)
    }
}`;

    const expected = ["combine-sink-self-capture-searchviewmodel"];
    assert.deepEqual(findingIds(trailing), expected);
    assert.deepEqual(findingIds(argument), expected);
  });
});

describe("delegate properties", () => {
  test("each strong delegate property is reported, weak ones are not", () => {
    const code = `
protocol TrackerDelegate: AnyObject {}

class Tracker {
    weak var delegate: TrackerDelegate?
    var analyticsDelegate: AnalyticsDelegate?
    var delegateQueue: DispatchQueue?
}`;

    assert.deepEqual(findingIds(code), [
      "strong-delegate-risk-tracker-analyticsdelegate"
    ]);
  });

  test("protocol requirements and computed properties are not reported", () => {
    const code = `
protocol Configurable {
    var delegate: ConfigDelegate? { get set }
}

class ProxyTableView: UITableView {
    override var delegate: UITableViewDelegate? {
        get { super.delegate }
        set { super.delegate = newValue }
    }
}`;

    assert.deepEqual(findingIds(code), []);
  });

  test("a stored delegate with didSet is reported", () => {
    const code = `
class Child {
    var delegate: ChildDelegate? {
        didSet { print("delegate changed") }
    }
}`;

    assert.deepEqual(findingIds(code), ["strong-delegate-risk-child-delegate"]);
  });
});
