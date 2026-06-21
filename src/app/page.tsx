"use client";

import { useState } from "react";
import { scanSwiftCode, type LeakFinding } from "@/lib/scanner/swiftLeakScanner";

const feedbackFormUrl = "https://forms.gle/UtAHqg1pCPpaTzPK9";

const sampleSwiftCode = `//
//  ViewController.swift
//  LeakyLeaks
//

import UIKit

class MainViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
    }

    @IBAction func presentModalViewController(_ sender: Any) {
        guard let modalViewController = UIStoryboard(name: "ModalViewController", bundle: nil).instantiateInitialViewController() as? ModalViewController else { return }
        
        modalViewController.closeActionHandler = {
            modalViewController.dismiss(animated: true, completion: nil)
        }
        
        present(modalViewController, animated: true, completion: nil)
    }
    
    @IBAction func initializeLeakyObject(_ sender: Any) {
        var classB: ClassB? = ClassB(otherValue: "test")
        var classA: ClassA? = ClassA(someValue: 7)
        classA?.classB = classB
        classB?.classA = classA
        
        classA = nil
        classB = nil
    }
}

class ClassA {
    let someValue: Int
    var classB: ClassB?
    
    init(someValue: Int) {
        self.someValue = someValue
        print("ClassA allocated")
    }
    
    deinit {
        print("ClassA deallocated")
    }
}

class ClassB {
    let otherValue: String
    var classA: ClassA?
    
    init(otherValue: String) {
        self.otherValue = otherValue
        print("ClassB allocated")
    }
    
    deinit {
        print("ClassB deallocated")
    }
}`;

export default function Home() {
  const [fileName, setFileName] = useState("ViewController.swift");
  const [code, setCode] = useState("");
  const [findings, setFindings] = useState<LeakFinding[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const handleAnalyze = () => {
    const safeFileName = fileName.trim() || "Pasted Swift Code";
    const result = scanSwiftCode(code, safeFileName);
    setFindings(result);
    setHasScanned(true);
    setCopyStatus("");
  };

  const handleLoadSample = () => {
    setFileName("ViewController.swift");
    setCode(sampleSwiftCode);
    setFindings([]);
    setHasScanned(false);
    setCopyStatus("");
  };

  const handleClearCode = () => {
    setFileName("ViewController.swift");
    setCode("");
    setFindings([]);
    setHasScanned(false);
    setCopyStatus("");
  };

  const highestRisk = findings.some((finding) => finding.risk === "High")
    ? "High"
    : findings.some((finding) => finding.risk === "Medium")
      ? "Medium"
      : "Low";

  const buildReportText = () => {
    if (!hasScanned) {
      return "";
    }

    if (findings.length === 0) {
      return `RS Forge AI - Swift Memory Leak Analysis

File: ${fileName.trim() || "Pasted Swift Code"}
Findings: 0
Highest Risk: Low
Scanner Version: v0.3

No high-risk memory leak pattern detected in this scanner version.`;
    }

    const reportItems = findings
      .map(
        (finding, index) => `
${index + 1}. ${finding.title}
File: ${finding.fileName}
Risk: ${finding.risk}
Pattern: ${finding.pattern}
Possible Retain Chain: ${finding.retainChain}

Why:
${finding.whyItHappens}

Fix:
${finding.fix}

Xcode Verification:
${finding.verificationSteps.map((step) => `- ${step}`).join("\n")}
`
      )
      .join("\n----------------------\n");

    return `RS Forge AI - Swift Memory Leak Analysis

File: ${fileName.trim() || "Pasted Swift Code"}
Findings: ${findings.length}
Highest Risk: ${highestRisk}
Scanner Version: v0.3

${reportItems}`;
  };

  const handleCopyReport = async () => {
    const reportText = buildReportText();

    if (!reportText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(reportText);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-6 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-200">
          RS Forge AI · Swift Memory Leak Analyzer
        </div>

        <h1 className="max-w-4xl text-center text-4xl font-bold tracking-tight sm:text-6xl">
          Find iOS memory leaks before they crash your app.
        </h1>

        <p className="mt-6 max-w-2xl text-center text-lg text-slate-300">
          Paste Swift code and get retain-cycle explanation, exact fix, and
          Xcode verification steps.
        </p>

        <div className="mt-6 max-w-4xl rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <strong>Privacy Notice:</strong> Do not paste confidential company
          code, API keys, tokens, customer data, private URLs, or proprietary
          business logic. Use sanitized sample code for beta testing.
        </div>

        <a
          href={feedbackFormUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex rounded-lg border border-cyan-400/40 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/10"
        >
          Share Feedback
        </a>

        <div className="mt-10 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Issue Type
              </label>
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-200 outline-none focus:border-cyan-400">
                <option>Memory Leak</option>
                <option>Retain Cycle</option>
                <option>Crash Risk</option>
                <option>Performance</option>
                <option>Kiosk / Long-running Memory Growth</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Mode
              </label>
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-200 outline-none focus:border-cyan-400">
                <option>Beginner Mode</option>
                <option>Developer Mode</option>
                <option>Team Review Mode</option>
              </select>
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-slate-300">
              File Name
            </label>
            <input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400"
              placeholder="Example: ViewController.swift"
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="block text-sm font-medium text-slate-300">
                Paste Swift Code
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleLoadSample}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                >
                  Load Sample Code
                </button>

                <button
                  onClick={handleClearCode}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-red-400 hover:text-red-200"
                >
                  Clear
                </button>
              </div>
            </div>

            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="min-h-64 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400"
              placeholder="Paste your Swift ViewController, Cell, ViewModel, or closure code here..."
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={code.trim().length === 0}
            className="mt-5 w-full rounded-lg bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Analyze Memory Risk
          </button>

          {hasScanned && (
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-semibold">Analysis Result</h2>

                <div className="flex items-center gap-3">
                  {copyStatus && (
                    <span className="text-sm text-slate-400">{copyStatus}</span>
                  )}

                  <button
                    onClick={handleCopyReport}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                  >
                    Copy Report
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">File</p>
                  <p className="mt-1 break-all text-sm font-semibold text-white">
                    {fileName.trim() || "Pasted Swift Code"}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Findings</p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {findings.length}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Highest Risk</p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {highestRisk}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm text-slate-400">Scanner Version</p>
                  <p className="mt-1 text-2xl font-bold text-white">v0.3</p>
                </div>
              </div>

              {findings.length === 0 ? (
                <p className="mt-5 text-slate-400">
                  No high-risk memory leak pattern detected in this scanner
                  version.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {findings.map((finding) => (
                    <div
                      key={finding.id}
                      className="rounded-lg border border-slate-800 bg-slate-900 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-cyan-200">
                          {finding.title}
                        </h3>

                        <span className="rounded-full border border-cyan-400/30 px-3 py-1 text-xs text-cyan-200">
                          {finding.risk}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-slate-300">
                        <strong>File:</strong> {finding.fileName}
                      </p>

                      <p className="mt-2 text-sm text-slate-300">
                        <strong>Pattern:</strong> {finding.pattern}
                      </p>

                      <p className="mt-2 text-sm text-slate-300">
                        <strong>Possible Retain Chain:</strong>{" "}
                        {finding.retainChain}
                      </p>

                      <p className="mt-2 text-sm text-slate-300">
                        <strong>Why:</strong> {finding.whyItHappens}
                      </p>

                      <p className="mt-2 text-sm text-slate-300">
                        <strong>Fix:</strong> {finding.fix}
                      </p>

                      <div className="mt-3">
                        <strong className="text-sm text-slate-300">
                          Xcode Verification:
                        </strong>

                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
                          {finding.verificationSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Retain Chain</h3>
            <p className="mt-2 text-sm text-slate-400">
              Understand what is holding your ViewController in memory.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Exact Fix</h3>
            <p className="mt-2 text-sm text-slate-400">
              Get practical Swift fixes like weak self, cleanup, and lifecycle
              handling.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Xcode Verify</h3>
            <p className="mt-2 text-sm text-slate-400">
              Learn how to verify deinit, Memory Graph, and repeated-flow memory
              growth.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}