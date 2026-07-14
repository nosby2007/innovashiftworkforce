import { Injectable, TemplateRef } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ModalRef {
  title: string;
  tpl: TemplateRef<any>;
  context?: Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class ModalService {
  private refSubject = new BehaviorSubject<ModalRef | null>(null);
  ref$ = this.refSubject.asObservable();

  open(title: string, tpl: TemplateRef<any>, context?: Record<string, any>) {
    this.refSubject.next({ title, tpl, context });
  }

  close() {
    this.refSubject.next(null);
  }
}
