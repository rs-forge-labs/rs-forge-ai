// Demo code for the "Load Sample Code" button. It contains two leaks the
// scanner should find: a closure capturing its own owner, and two classes
// holding strong references to each other.
export const sampleSwiftCode = `//
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
