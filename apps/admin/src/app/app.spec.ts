import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the router outlet only', () => {
    const fixture = TestBed.createComponent(App);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.children).toHaveLength(1);
    expect(element.firstElementChild?.tagName.toLowerCase()).toBe('router-outlet');
  });
});
