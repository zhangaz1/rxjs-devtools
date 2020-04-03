import { BasePlugin } from 'rxjs-spy';
import { Spy } from 'rxjs-spy/spy-interface';
import { Observable, Subscription, Subject } from 'rxjs';
import {
  EXTENSION_KEY
} from '@shared/consts';
import {
  Connection,
  PostMessage,
  Extension,
  MessageTypes,
  ObservableNotification,
  NotificationType
} from '@shared/interfaces';
import { SubscriptionRef, SubscriberRef } from 'rxjs-spy/subscription-ref';
import { filter, bufferTime } from 'rxjs/operators';
import { read } from 'rxjs-spy/match';

// TO-DO: Remove lodash dependency
import {
  isPlainObject,
  isArray,
  isBoolean,
  isNumber,
  isString,
  isUndefined,
  overSome,
} from 'lodash';

let idCounter = 0;
const identify = (args?: any) => String(idCounter++);

type Options = {
  verbose: boolean;
};

const BATCH_MILLISECONDS = 100;
const BATCH_NOTIFICATIONS = 150;


export default class DevToolsPlugin extends BasePlugin {
  public options: Options;
  private batchTimeoutId_: any;
  private connection_: Connection | undefined;
  private spy_: Spy;

  // Stream of notifications that are pushed to the devtools
  private notification$: Subject<ObservableNotification>;
  private notificationSubscription: Subscription;

  // Stream of responses from the extension
  private postMessage$: Observable<PostMessage>;
  private postMessageSubscription: Subscription;

  constructor(spy: Spy, options: Options = { verbose: false }) {
    super('devTools');
    this.log('Setting up');

    this.options = options;
    this.spy_ = spy;
    this.notification$ = new Subject();

    if (typeof window !== 'undefined' && window[EXTENSION_KEY]) {
      const extension = window[EXTENSION_KEY] as Extension;
      this.connection_ = extension.connect({ version: spy.version });
      this.log('Extension connected');


      this.notificationSubscription = this.notification$.pipe(
        bufferTime(BATCH_MILLISECONDS, null, BATCH_NOTIFICATIONS),
        filter(buffer => buffer.length > 0)
      ).subscribe(notifications => {
        this.log('Posting batch notification from rxjs-spy-devtools-plugin', notifications);
        this.connection_.post({
          messageType: MessageTypes.BATCH,
          data: notifications.map(notification => ({
            messageType: MessageTypes.NOTIFICATION,
            data: notification
          }))
        });
      })

      this.postMessage$ = new Observable<PostMessage>(observer =>
        this.connection_
          ? this.connection_.subscribe(post => observer.next(post))
          : () => { }
      );

      this.postMessageSubscription = this.postMessage$
        .subscribe(message => {
          this.log('Message from extension', message);
          if (this.connection_) {
            // this.connection_.post(response);
          }
        });
    }
  }
  beforeNext(ref: SubscriptionRef, value: any): void {
    this.sendNotification({
      notificationType: NotificationType.NEXT,
      prefix: 'before',
      ref,
      value: serialize(value)
    });
  }

  teardown(): void {
    if (this.batchTimeoutId_ !== undefined) {
      clearTimeout(this.batchTimeoutId_);
      this.batchTimeoutId_ = undefined;
    }
    if (this.connection_) {
      this.connection_.disconnect();
      this.connection_ = undefined;
    }
    this.postMessageSubscription?.unsubscribe();
    this.notificationSubscription?.unsubscribe();
  }

  private log(...messages: any) {
    if (this.options.verbose) {
      console.log('rxjs-spy-devtools-plugin: ', ...messages);
    }
  }

  private sendNotification({ notificationType, value, ref, prefix }:
    { notificationType: NotificationType, value: any, prefix: 'before' | 'after', ref: SubscriberRef }
  ): void {
    const observable = ref.observable;
    const tag = read(observable);
    // For now skip anything that doesn't have a tag
    if (!tag) {
      return;
    }
    this.notification$.next({
      id: identify(),
      notificationType,
      prefix,
      tick: this.spy_.tick,
      timestamp: Date.now(),
      observable: {
        tag,
        value
      }
    });
  }
}

const getCircularReplacer = () => {
  const seen = new WeakSet();
  return (_: any, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

const serialize = (obj: any) => {
  if (
    overSome([
      isPlainObject,
      isArray,
      isBoolean,
      isNumber,
      isString,
      isUndefined,
    ])(obj)
  ) {
    return JSON.stringify(obj, getCircularReplacer());
  } else {
    return JSON.stringify({
      nonSerializable: true,
    });
  }
};